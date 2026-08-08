import type { BrowserEventV2 } from '@visual-ai/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildCanonicalBatchRequest,
  sha256CanonicalBatch
} from '../src/navigation/canonical-request.js';
import type {
  NavigationBatchRecord,
  NavigationEventRecord
} from '../src/navigation/navigation-repository.js';

function event(sequence: number, overrides: Partial<BrowserEventV2> = {}): NavigationEventRecord {
  return {
    client_event_id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    sequence_number: sequence,
    event_kind: 'navigation',
    occurred_at: `2026-08-08T00:00:0${sequence}.000Z`,
    page_domain: 'example.com',
    transition_type: 'link',
    capture_policy_version: 'm4-navigation-v1',
    delivery_state: 'batched',
    batch_id: '00000000-0000-4000-8000-000000000099',
    created_at: '2026-08-08T00:01:00.000Z',
    ...overrides
  };
}

function batch(eventIds: readonly string[]): NavigationBatchRecord {
  return {
    batch_id: '00000000-0000-4000-8000-000000000099',
    idempotency_key: '00000000-0000-4000-8000-000000000098',
    device_id: '00000000-0000-4000-8000-000000000001',
    session_id: '00000000-0000-4000-8000-000000000002',
    event_ids: eventIds,
    canonical_request_hash: '0'.repeat(64),
    retry_count: 0,
    next_retry_at: '2026-08-08T00:01:00.000Z',
    delivery_state: 'pending',
    created_at: '2026-08-08T00:01:00.000Z',
    updated_at: '2026-08-08T00:01:00.000Z'
  };
}

describe('canonical navigation batch request', () => {
  it('builds only device, session, and ordered seven-field v2 events', () => {
    const first = event(1);
    const second = event(2);
    const request = buildCanonicalBatchRequest(
      batch([first.client_event_id, second.client_event_id]),
      [second, first]
    );

    expect(Object.keys(request)).toEqual(['device_id', 'session_id', 'events']);
    expect(request.events.map((item) => item.client_event_id)).toEqual([
      first.client_event_id,
      second.client_event_id
    ]);
    expect(Object.keys(request.events[0]).sort()).toEqual(
      [
        'capture_policy_version',
        'client_event_id',
        'event_kind',
        'occurred_at',
        'page_domain',
        'sequence_number',
        'transition_type'
      ].sort()
    );
    expect(JSON.stringify(request)).not.toContain('batch_id');
    expect(JSON.stringify(request)).not.toContain('delivery_state');
  });

  it('hashes identical ordered data identically and changes for order or allowed fields', async () => {
    const first = event(1);
    const second = event(2);
    const forward = buildCanonicalBatchRequest(
      batch([first.client_event_id, second.client_event_id]),
      [first, second]
    );
    const same = buildCanonicalBatchRequest(
      batch([first.client_event_id, second.client_event_id]),
      [second, first]
    );
    const reversed = buildCanonicalBatchRequest(
      batch([second.client_event_id, first.client_event_id]),
      [first, second]
    );
    const changedDomain = buildCanonicalBatchRequest(
      batch([first.client_event_id, second.client_event_id]),
      [first, event(2, { page_domain: 'example.org' })]
    );

    expect(same).toEqual(forward);
    await expect(sha256CanonicalBatch(same)).resolves.toBe(await sha256CanonicalBatch(forward));
    await expect(sha256CanonicalBatch(reversed)).resolves.not.toBe(
      await sha256CanonicalBatch(forward)
    );
    await expect(sha256CanonicalBatch(changedDomain)).resolves.not.toBe(
      await sha256CanonicalBatch(forward)
    );
  });
});
