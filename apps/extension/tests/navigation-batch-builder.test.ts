import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CaptureContext } from '../src/navigation/capture-gate.js';
import { formNextBatch, MAX_BATCH_EVENTS } from '../src/navigation/batch-builder.js';
import {
  buildCanonicalBatchRequest,
  sha256CanonicalBatch
} from '../src/navigation/canonical-request.js';
import type { NavigationBatchRecord } from '../src/navigation/navigation-repository.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';

const context: CaptureContext = {
  generation: 1,
  deviceId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  capturePolicyVersion: 'm4-navigation-v1'
};

function eventId(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

describe('navigation batch builder', () => {
  it('atomically fixes the first twenty ordered members and never admits later events', async () => {
    const database = await openControlPlaneDatabase(`batch-${crypto.randomUUID()}`);
    const repository = database.createNavigationRepository(() => new Date('2026-08-08T02:00:00Z'));
    await repository.openSession(context);
    for (let sequence = 1; sequence <= 21; sequence++) {
      await repository.appendDraft(
        {
          client_event_id: eventId(sequence),
          event_kind: 'navigation',
          occurred_at: `2026-08-08T00:00:${sequence.toString().padStart(2, '0')}.000Z`,
          page_domain: 'example.com',
          transition_type: 'link',
          capture_policy_version: 'm4-navigation-v1'
        },
        context
      );
    }

    const batch = await formNextBatch(repository, context);

    expect(MAX_BATCH_EVENTS).toBe(20);
    expect(batch).toMatchObject({
      device_id: context.deviceId,
      session_id: context.sessionId,
      event_ids: Array.from({ length: 20 }, (_, index) => eventId(index + 1)),
      retry_count: 0,
      next_retry_at: '2026-08-08T02:00:00.000Z',
      delivery_state: 'pending',
      created_at: '2026-08-08T02:00:00.000Z',
      updated_at: '2026-08-08T02:00:00.000Z'
    });
    expect(batch?.batch_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(batch?.idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await repository.listUnbatched()).toMatchObject([
      { client_event_id: eventId(21), sequence_number: 21, delivery_state: 'unbatched' }
    ]);
    expect(
      (await repository.listEventsForBatch(batch!.batch_id)).map((row) => row.client_event_id)
    ).toEqual(batch!.event_ids);

    await repository.appendDraft(
      {
        client_event_id: eventId(22),
        event_kind: 'navigation',
        occurred_at: '2026-08-08T00:00:22.000Z',
        page_domain: 'example.org',
        transition_type: 'typed',
        capture_policy_version: 'm4-navigation-v1'
      },
      context
    );

    expect((await repository.getBatch(batch!.batch_id))?.event_ids).toEqual(
      Array.from({ length: 20 }, (_, index) => eventId(index + 1))
    );
    expect(
      (await repository.listEventsForBatch(batch!.batch_id)).map((row) => row.client_event_id)
    ).toEqual(batch!.event_ids);
    const persistedEvents = await repository.listEventsForBatch(batch!.batch_id);
    await expect(
      sha256CanonicalBatch(buildCanonicalBatchRequest(batch!, persistedEvents))
    ).resolves.toBe(batch!.canonical_request_hash);
    expect(batch!.canonical_request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect((await repository.getBatch(batch!.batch_id))?.canonical_request_hash).toBe(
      batch!.canonical_request_hash
    );
    database.close();
  });

  it('rejects a direct repository caller that requests more than twenty members', async () => {
    const database = await openControlPlaneDatabase(`batch-direct-${crypto.randomUUID()}`);
    const repository = database.createNavigationRepository(() => new Date('2026-08-08T02:00:00Z'));
    await repository.openSession(context);
    for (let sequence = 1; sequence <= 21; sequence++) {
      await repository.appendDraft(
        {
          client_event_id: eventId(sequence),
          event_kind: 'navigation',
          occurred_at: `2026-08-08T00:00:${sequence.toString().padStart(2, '0')}.000Z`,
          page_domain: 'example.com',
          transition_type: 'link',
          capture_policy_version: 'm4-navigation-v1'
        },
        context
      );
    }
    const events = await repository.listNextUnbatched(21);
    const eventIds = events.map((event) => event.client_event_id);
    const hashInput: NavigationBatchRecord = {
      batch_id: '',
      idempotency_key: '',
      device_id: context.deviceId,
      session_id: context.sessionId,
      event_ids: eventIds,
      canonical_request_hash: '0'.repeat(64),
      retry_count: 0,
      next_retry_at: '',
      delivery_state: 'pending',
      created_at: '',
      updated_at: ''
    };
    const hash = await sha256CanonicalBatch(buildCanonicalBatchRequest(hashInput, events));

    await expect(repository.formNextBatch(context, 21, eventIds, hash)).resolves.toBeNull();
    expect(await repository.listUnbatched()).toHaveLength(21);
    database.close();
  });
});
