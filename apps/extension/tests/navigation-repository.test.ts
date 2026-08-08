import type { BrowserEventV2 } from '@visual-ai/contracts';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CaptureContext } from '../src/navigation/capture-gate.js';
import { formNextBatch } from '../src/navigation/batch-builder.js';
import type { NavigationEventRecord } from '../src/navigation/navigation-repository.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';

const context: CaptureContext = {
  generation: 1,
  deviceId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  capturePolicyVersion: 'm4-navigation-v1'
};

function event(overrides: Partial<BrowserEventV2> = {}): BrowserEventV2 {
  return {
    client_event_id: crypto.randomUUID(),
    sequence_number: 1,
    event_kind: 'navigation',
    occurred_at: '2026-08-08T00:00:00.000Z',
    page_domain: 'example.com',
    transition_type: 'link',
    capture_policy_version: 'm4-navigation-v1',
    ...overrides
  };
}

function draft(overrides: Partial<Omit<BrowserEventV2, 'sequence_number'>> = {}) {
  const { sequence_number, ...value } = event(overrides);
  void sequence_number;
  return value;
}

async function setup(limits?: { maxPendingEvents?: number; maxPendingEventBytes?: number }) {
  const database = await openControlPlaneDatabase(`navigation-${crypto.randomUUID()}`);
  const repository = database.createNavigationRepository(undefined, limits);
  await repository.openSession(context);
  return { database, repository };
}

describe('NavigationRepository strict persistence boundary', () => {
  it('does not expose raw navigation-store transactions on the production database API', async () => {
    const { database, repository } = await setup();

    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(database))).not.toContain(
      'navigationTransaction'
    );
    await expect(repository.append(event(), context)).resolves.toBe('appended');
    await expect(repository.listUnbatched()).resolves.toHaveLength(1);

    database.close();
  });

  it('writes only the exact navigation event record keys', async () => {
    const { database, repository } = await setup();

    await expect(repository.append(event(), context)).resolves.toBe('appended');

    const [record] = await repository.listUnbatched();
    expect(Object.keys(record).sort()).toEqual(
      [
        'capture_policy_version',
        'client_event_id',
        'created_at',
        'delivery_state',
        'event_kind',
        'occurred_at',
        'page_domain',
        'sequence_number',
        'transition_type'
      ].sort()
    );
    expect(record).toMatchObject({ delivery_state: 'unbatched', page_domain: 'example.com' });
    database.close();
  });

  it.each(['url', 'hostname', 'title', 'tab_id', 'document_id', 'metadata', 'unknown'])(
    'rejects prohibited or unknown event key %s before writing',
    async (field) => {
      const { database, repository } = await setup();
      const candidate = { ...event(), [field]: field === 'metadata' ? { arbitrary: true } : 'x' };

      await expect(repository.append(candidate as BrowserEventV2, context)).rejects.toThrow(
        'navigation event has invalid fields'
      );
      await expect(repository.listUnbatched()).resolves.toEqual([]);
      database.close();
    }
  );

  it('rejects unknown capture context keys before writing', async () => {
    const { database, repository } = await setup();

    await expect(
      repository.append(event(), {
        ...context,
        url: 'https://example.invalid/private'
      } as CaptureContext)
    ).rejects.toThrow('capture context has invalid fields');
    await expect(repository.listUnbatched()).resolves.toEqual([]);
    database.close();
  });

  it('returns only unbatched records', async () => {
    const { database, repository } = await setup();
    const first = event();
    await repository.append(first, context);

    const rows = await repository.listUnbatched();
    expect(rows).toHaveLength(1);
    expect((rows[0] satisfies NavigationEventRecord).client_event_id).toBe(first.client_event_id);
    database.close();
  });

  it('blocks navigation stores and coordination state from generic persistence', async () => {
    const { database, repository } = await setup();
    const candidate = {
      ...event(),
      hostname: 'private.example',
      delivery_state: 'unbatched',
      created_at: '2026-08-08T00:00:00.000Z'
    };

    await expect(database.put('navigation_event_buffer' as never, candidate)).rejects.toThrow(
      'strict navigation repository'
    );
    await expect(
      database.put('navigation_batches' as never, {
        batch_id: 'batch-1',
        metadata: { arbitrary: true }
      })
    ).rejects.toThrow('strict navigation repository');
    await expect(
      database.put('sync_metadata', {
        id: 'navigation_coordination',
        hostname: 'private.example'
      })
    ).rejects.toThrow('strict navigation repository');
    await expect(repository.listUnbatched()).resolves.toEqual([]);
    database.close();
  });

  it('applies capacity accounting to the full-event append boundary', async () => {
    const { database, repository } = await setup({
      maxPendingEvents: 1,
      maxPendingEventBytes: 1_048_576
    });

    await expect(repository.append(event(), context)).resolves.toBe('appended');
    await expect(repository.append(event(), context)).resolves.toBe('capacity_exceeded');
    expect(await repository.getCoordinationState()).toMatchObject({
      event_count: 1,
      next_sequence_number: 2
    });
    database.close();
  });

  it('purges only the matching session event, batch, and coordination records', async () => {
    const { database, repository } = await setup();
    await repository.appendDraft(draft(), context);
    const batch = await formNextBatch(repository, context);

    await repository.purgeSession('00000000-0000-4000-8000-000000000099');
    expect(await repository.getBatch(batch!.batch_id)).not.toBeNull();

    await repository.purgeSession(context.sessionId);
    expect(await repository.listUnbatched()).toEqual([]);
    expect(await repository.listEventsForBatch(batch!.batch_id)).toEqual([]);
    expect(await repository.getBatch(batch!.batch_id)).toBeNull();
    expect(await repository.getCoordinationState()).toBeNull();
    database.close();
  });

  it('persists one lifecycle intent across restart and rejects a conflicting control intent', async () => {
    const databaseName = `navigation-lifecycle-${crypto.randomUUID()}`;
    const database = await openControlPlaneDatabase(databaseName);
    const repository = database.createNavigationRepository();
    await repository.openSession(context);

    await repository.closeForLifecycle(context.sessionId, 'pause');

    expect(await repository.getCoordinationState()).toMatchObject({
      gate_open: false,
      lifecycle_intent: 'pause'
    });
    await expect(repository.closeForLifecycle(context.sessionId, 'complete')).rejects.toThrow(
      'conflicting navigation lifecycle intent'
    );
    database.close();

    const reopened = await openControlPlaneDatabase(databaseName);
    const restarted = reopened.createNavigationRepository();
    expect(await restarted.getLifecycleIntent(context.sessionId)).toBe('pause');
    await restarted.clearLifecycleIntent(context.sessionId, 'pause');
    expect(await restarted.getLifecycleIntent(context.sessionId)).toBeNull();
    reopened.close();
  });

  it('allocates durable unique monotonic sequences atomically across restart', async () => {
    const name = `navigation-sequence-${crypto.randomUUID()}`;
    const database = await openControlPlaneDatabase(name);
    const repository = database.createNavigationRepository();
    await repository.openSession(context);

    await Promise.all([
      repository.appendDraft(draft(), context),
      repository.appendDraft(draft(), context),
      repository.appendDraft(draft(), context)
    ]);
    expect((await repository.listUnbatched()).map((record) => record.sequence_number)).toEqual([
      1, 2, 3
    ]);
    database.close();

    const reopened = await openControlPlaneDatabase(name);
    const restartedRepository = reopened.createNavigationRepository();
    await expect(restartedRepository.appendDraft(draft(), context)).resolves.toBe('appended');
    expect(
      (await restartedRepository.listUnbatched()).map((record) => record.sequence_number)
    ).toEqual([1, 2, 3, 4]);
    reopened.close();
  });

  it('rejects the next event at the count cap without evicting old rows', async () => {
    const { database, repository } = await setup({
      maxPendingEvents: 2,
      maxPendingEventBytes: 1_048_576
    });
    await repository.openSession(context);
    const first = draft({ client_event_id: '00000000-0000-4000-8000-000000000011' });
    const second = draft({ client_event_id: '00000000-0000-4000-8000-000000000012' });
    const rejected = draft({ client_event_id: '00000000-0000-4000-8000-000000000013' });

    await expect(repository.appendDraft(first, context)).resolves.toBe('appended');
    await expect(repository.appendDraft(second, context)).resolves.toBe('appended');
    await expect(repository.appendDraft(rejected, context)).resolves.toBe('capacity_exceeded');

    expect((await repository.listUnbatched()).map((row) => row.client_event_id)).toEqual([
      first.client_event_id,
      second.client_event_id
    ]);
    const state = await repository.getCoordinationState();
    expect(state?.event_count).toBe(2);
    expect(state?.next_sequence_number).toBe(3);
    database.close();
  });

  it('rejects the next event at the byte cap with exact durable byte counters', async () => {
    const createdAt = '2026-08-08T00:00:00.000Z';
    const first = draft({ client_event_id: '00000000-0000-4000-8000-000000000021' });
    const second = draft({ client_event_id: '00000000-0000-4000-8000-000000000022' });
    const rejected = draft({ client_event_id: '00000000-0000-4000-8000-000000000023' });
    const recordBytes = (candidate: typeof first, sequence: number) =>
      new TextEncoder().encode(
        JSON.stringify({
          ...candidate,
          sequence_number: sequence,
          delivery_state: 'unbatched',
          created_at: createdAt
        })
      ).byteLength;
    const exactTwoRecordCap = recordBytes(first, 1) + recordBytes(second, 2);
    const { database, repository } = await setup({
      maxPendingEvents: 1_000,
      maxPendingEventBytes: exactTwoRecordCap
    });
    await repository.openSession(context);

    await expect(repository.appendDraft(first, context)).resolves.toBe('appended');
    await expect(repository.appendDraft(second, context)).resolves.toBe('appended');
    await expect(repository.appendDraft(rejected, context)).resolves.toBe('capacity_exceeded');

    expect((await repository.listUnbatched()).map((row) => row.client_event_id)).toEqual([
      first.client_event_id,
      second.client_event_id
    ]);
    const state = await repository.getCoordinationState();
    expect(state).toMatchObject({
      event_count: 2,
      event_bytes: exactTwoRecordCap,
      next_sequence_number: 3
    });
    database.close();
  });
});
