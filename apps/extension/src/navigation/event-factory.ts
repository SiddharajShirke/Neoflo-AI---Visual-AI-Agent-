import { isBrowserEventV2, type BrowserEventV2 } from '@visual-ai/contracts';

export function createNavigationEvent(input: {
  pageDomain: string;
  transitionType: BrowserEventV2['transition_type'];
  occurredAt: Date;
}): Omit<BrowserEventV2, 'sequence_number'> {
  const event: Omit<BrowserEventV2, 'sequence_number'> = {
    client_event_id: crypto.randomUUID(),
    event_kind: 'navigation',
    occurred_at: input.occurredAt.toISOString(),
    page_domain: input.pageDomain,
    transition_type: input.transitionType,
    capture_policy_version: 'm4-navigation-v1'
  };
  if (!isBrowserEventV2({ ...event, sequence_number: 1 })) {
    throw new Error('invalid navigation event input');
  }
  return event;
}
