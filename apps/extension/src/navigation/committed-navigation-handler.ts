import type { BrowserEventV2 } from '@visual-ai/contracts';
import type { CaptureGate } from './capture-gate.js';
import type { NavigationDuplicateCache } from './duplicate-cache.js';
import { createNavigationEvent } from './event-factory.js';
import type { NavigationRepository } from './navigation-repository.js';
import type { NormalizeResult } from '../privacy/domain-normalizer.js';
import type { ProtectedCategory } from '../privacy/protected-domain-policy.js';
import type { NavigationMetrics } from './metrics.js';

export interface CommittedNavigationDetails {
  frameId: number;
  url: string;
  transitionType: string;
  documentId?: string;
  tabId?: number;
  timeStamp?: number;
}

export type NavigationIgnoredReason =
  | 'ignored_protected_domain'
  | 'ignored_user_domain'
  | 'ignored_transition';

export interface CommittedNavigationDependencies {
  gate: CaptureGate;
  repository: Pick<NavigationRepository, 'appendDraft' | 'closeWithSyncError'>;
  normalize(rawUrl: string): NormalizeResult;
  matchProtected(hostname: string): ProtectedCategory | null;
  isUserExcluded?(hostname: string): Promise<boolean>;
  incrementIgnored?(reason: NavigationIgnoredReason): void;
  duplicateCache?: NavigationDuplicateCache;
  nowMs?: () => number;
  now?: () => Date;
  performanceNow?: () => number;
  metrics?: NavigationMetrics;
  onSyncError?: () => void;
}

const transitionTypes = new Set<BrowserEventV2['transition_type']>([
  'link',
  'typed',
  'auto_bookmark',
  'generated',
  'start_page',
  'form_submit',
  'reload',
  'keyword',
  'keyword_generated'
]);

function allowedTransition(value: string): BrowserEventV2['transition_type'] | null {
  return transitionTypes.has(value as BrowserEventV2['transition_type'])
    ? (value as BrowserEventV2['transition_type'])
    : null;
}

function transientDuplicateKey(
  details: CommittedNavigationDetails,
  generation: number
): string | null {
  if (typeof details.documentId === 'string' && details.documentId.length > 0) {
    return `${generation}:document:${details.documentId}`;
  }
  if (Number.isInteger(details.tabId) && typeof details.timeStamp === 'number') {
    return `${generation}:tab:${details.tabId}:timestamp:${details.timeStamp}`;
  }
  return null;
}

export function createCommittedNavigationHandler(
  dependencies: CommittedNavigationDependencies
): (details: CommittedNavigationDetails) => Promise<void> {
  return (details) => handleCommittedNavigation(details, dependencies);
}

export async function handleCommittedNavigation(
  details: CommittedNavigationDetails,
  dependencies: CommittedNavigationDependencies
): Promise<void> {
  const performanceNow = dependencies.performanceNow ?? (() => performance.now());
  const handlerStarted = performanceNow();
  const lease = dependencies.gate.acquire();
  if (lease === null) return;

  try {
    if (details.frameId !== 0) {
      dependencies.metrics?.incrementIgnored('ignored_subframe');
      return;
    }

    const normalizedStarted = performanceNow();
    const normalized = dependencies.normalize(details.url);
    dependencies.metrics?.recordDuration(
      'normalize_filter_ms',
      performanceNow() - normalizedStarted
    );
    if (normalized.kind === 'ignored') {
      dependencies.metrics?.incrementIgnored(
        normalized.reason === 'non_http' ? 'ignored_non_http' : 'ignored_invalid_domain'
      );
      return;
    }

    if (dependencies.matchProtected(normalized.matchingHostname) !== null) {
      dependencies.incrementIgnored?.('ignored_protected_domain');
      dependencies.metrics?.incrementIgnored('ignored_protected_domain');
      return;
    }
    if (await dependencies.isUserExcluded?.(normalized.matchingHostname)) {
      dependencies.incrementIgnored?.('ignored_user_domain');
      dependencies.metrics?.incrementIgnored('ignored_user_exclusion');
      return;
    }

    const transitionType = allowedTransition(details.transitionType);
    if (transitionType === null) {
      dependencies.incrementIgnored?.('ignored_transition');
      dependencies.metrics?.incrementIgnored('ignored_transition');
      return;
    }
    if (!dependencies.gate.isCurrent(lease.context)) return;

    const duplicateKey = transientDuplicateKey(details, lease.context.generation);
    if (
      duplicateKey !== null &&
      dependencies.duplicateCache?.seen(duplicateKey, (dependencies.nowMs ?? Date.now)())
    ) {
      dependencies.metrics?.incrementIgnored('ignored_duplicate');
      return;
    }

    const event = createNavigationEvent({
      pageDomain: normalized.pageDomain,
      transitionType,
      occurredAt: (dependencies.now ?? (() => new Date()))()
    });
    const appendStarted = performanceNow();
    const appendResult = await dependencies.repository.appendDraft(event, lease.context);
    dependencies.metrics?.recordDuration('indexeddb_append_ms', performanceNow() - appendStarted);
    if (appendResult === 'capacity_exceeded') {
      void dependencies.gate.close();
      await dependencies.repository.closeWithSyncError(lease.context);
      dependencies.onSyncError?.();
    }
  } finally {
    lease.release();
    dependencies.metrics?.recordDuration('capture_handler_ms', performanceNow() - handlerStarted);
  }
}
