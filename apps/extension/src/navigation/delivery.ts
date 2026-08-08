import { ApiClientError, type ApiClient } from '../api/client.js';
import { buildCanonicalBatchRequest, sha256CanonicalBatch } from './canonical-request.js';
import type { NavigationRepository } from './navigation-repository.js';
import type { NavigationMetrics } from './metrics.js';
import {
  isNavigationRetryable,
  navigationRetryAfterDelayMs,
  navigationRetryDelayMs
} from './retry.js';

export interface NavigationDeliveryHooks {
  onAuthRequired?: () => void | Promise<void>;
  onSessionNotRecording?: (sessionId: string) => Promise<NavigationSessionNotRecordingResolution>;
  onRetryScheduled?: () => void | Promise<void>;
  metrics?: NavigationMetrics;
  performanceNow?: () => number;
  onAuthorityOutcome?: (
    outcome: NavigationAuthorityOutcome,
    sessionId: string
  ) => void | Promise<void>;
  onSyncError?: (code: string) => void;
  random?: () => number;
}

export type NavigationSessionNotRecordingResolution = 'retry' | 'purged' | 'hold';

export type NavigationAuthorityOutcome =
  | 'device_revoked'
  | 'consent_inactive'
  | 'capture_policy_mismatch';

const authorityOutcomes = new Set<NavigationAuthorityOutcome>([
  'device_revoked',
  'consent_inactive',
  'capture_policy_mismatch'
]);

function isNavigationAuthorityOutcome(value: string): value is NavigationAuthorityOutcome {
  return authorityOutcomes.has(value as NavigationAuthorityOutcome);
}

/** One worker-local loop claims immutable navigation batches before every API call. */
export class NavigationDeliveryEngine {
  private delivering = false;

  constructor(
    private readonly repository: NavigationRepository,
    private readonly api: Pick<ApiClient, 'ingestBrowserEventBatch'>,
    private readonly hooks: NavigationDeliveryHooks = {}
  ) {}

  async deliverDue(now = new Date()): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    try {
      await this.repository.recoverStaleDelivering(now);
      for (const reconciling of await this.repository.listReconcilingBatches())
        await this.reconcileSessionNotRecording(reconciling, now);
      for (const due of await this.repository.listDueBatches(now)) {
        const batch = await this.repository.claimBatch(due.batch_id, now);
        if (batch === null) continue;
        await this.deliverClaimed(batch, now);
      }
    } finally {
      this.delivering = false;
    }
  }

  private async deliverClaimed(
    batch: Awaited<ReturnType<NavigationRepository['claimBatch']>> & {},
    now: Date
  ): Promise<void> {
    if (batch === null) return;
    try {
      const events = await this.repository.listEventsForBatch(batch.batch_id);
      const request = buildCanonicalBatchRequest(batch, events);
      if ((await sha256CanonicalBatch(request)) !== batch.canonical_request_hash) {
        await this.repository.setBatchDeliveryState(batch.batch_id, 'failed_permanent', now);
        this.hooks.onSyncError?.('canonical_request_hash_mismatch');
        return;
      }
      this.hooks.metrics?.recordBatchSize(batch.event_ids.length);
      this.hooks.metrics?.recordRetryCount(batch.retry_count);
      const started = (this.hooks.performanceNow ?? (() => performance.now()))();
      let response;
      try {
        response = await this.api.ingestBrowserEventBatch(request, batch.idempotency_key);
      } finally {
        this.hooks.metrics?.recordDuration(
          'batch_http_ms',
          (this.hooks.performanceNow ?? (() => performance.now()))() - started
        );
      }
      if (
        !(await this.repository.acknowledgeBatch(
          batch.batch_id,
          response.accepted_count,
          response.duplicate_count
        ))
      ) {
        this.hooks.onSyncError?.('acknowledgement_mismatch');
      }
    } catch (error) {
      const apiError = error instanceof ApiClientError ? error : null;
      if (apiError?.status === 401 && apiError.code === 'authentication_refreshed') {
        if (batch.retry_count < 7) {
          await this.repository.setBatchDeliveryState(batch.batch_id, 'pending', now, now);
          return;
        }
        await this.repository.setBatchDeliveryState(batch.batch_id, 'failed_permanent', now);
        this.hooks.onSyncError?.('authentication_retry_exhausted');
        return;
      }
      if (apiError?.status === 401) {
        await this.repository.setBatchDeliveryState(batch.batch_id, 'blocked_auth', now);
        await this.hooks.onAuthRequired?.();
        return;
      }
      if (apiError?.status === 409 && apiError.code === 'session_not_recording') {
        await this.repository.setBatchDeliveryState(batch.batch_id, 'reconciling', now);
        await this.reconcileSessionNotRecording(batch, now);
        return;
      }
      if (apiError?.status === 409 && isNavigationAuthorityOutcome(apiError.code)) {
        await this.repository.setBatchDeliveryState(batch.batch_id, 'failed_permanent', now);
        await this.hooks.onAuthorityOutcome?.(apiError.code, batch.session_id);
        return;
      }
      if (isNavigationRetryable(apiError?.status) && batch.retry_count < 7) {
        const retryAfter = navigationRetryAfterDelayMs(apiError?.retryAfter ?? null);
        const delay =
          retryAfter ?? navigationRetryDelayMs(batch.retry_count, this.hooks.random?.());
        await this.repository.setBatchDeliveryState(
          batch.batch_id,
          'pending',
          now,
          new Date(now.getTime() + delay)
        );
        return;
      }
      await this.repository.setBatchDeliveryState(batch.batch_id, 'failed_permanent', now);
      this.hooks.onSyncError?.(apiError?.code ?? 'network_error');
    }
  }

  private async reconcileSessionNotRecording(
    batch: NonNullable<Awaited<ReturnType<NavigationRepository['getBatch']>>>,
    now: Date
  ): Promise<void> {
    try {
      const resolution = await this.hooks.onSessionNotRecording?.(batch.session_id);
      if (resolution === 'retry') {
        await this.repository.setBatchDeliveryState(batch.batch_id, 'pending', now, now);
        await this.hooks.onRetryScheduled?.();
        return;
      }
      if (resolution === 'purged') return;
    } catch {
      // The persistent reconciling state remains a no-send hold for manual/startup recovery.
    }
    this.hooks.onSyncError?.('session_not_recording_reconciliation_failed');
  }
}
