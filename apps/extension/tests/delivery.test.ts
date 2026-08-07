import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneDatabase, openControlPlaneDatabase } from '../src/persistence/database.js';
import { createPendingMutation, enqueueMutation } from '../src/queue/mutations.js';
import { MutationDeliveryEngine } from '../src/queue/delivery.js';
import { ApiClientError } from '../src/api/client.js';

async function queued(
  database: ControlPlaneDatabase,
  type: 'pause_session' | 'resume_session' | 'complete_session'
) {
  const mutation = await createPendingMutation(
    type,
    { session_id: 'session-1' },
    new Date('2026-08-07T00:00:00.000Z')
  );
  await enqueueMutation(database, mutation);
  return mutation;
}

describe('durable mutation delivery', () => {
  it('reuses the stored idempotency key and removes a confirmed mutation', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'pause_session');
    const pauseSession = vi.fn().mockResolvedValue({ id: 'session-1', status: 'paused' });
    const engine = new MutationDeliveryEngine(database, { pauseSession } as never);
    await engine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect(pauseSession).toHaveBeenCalledWith('session-1', mutation.idempotency_key);
    expect(await database.getAll('pending_mutations')).toEqual([]);
    database.close();
  });

  it('blocks an unresolved mutation after the API client has refreshed once and remains unauthorized', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'pause_session');
    const onAuthRequired = vi.fn();
    const engine = new MutationDeliveryEngine(
      database,
      {
        pauseSession: vi.fn().mockRejectedValue(new ApiClientError(401, 'authentication_required'))
      } as never,
      { onAuthRequired }
    );
    await engine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect((await database.get('pending_mutations', mutation.local_operation_id))?.state).toBe(
      'blocked_auth'
    );
    expect(onAuthRequired).toHaveBeenCalledOnce();
    database.close();
  });

  it('reconciles a transition conflict only when the remote canonical status is already desired', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    await queued(database, 'pause_session');
    const onReconciled = vi.fn();
    const engine = new MutationDeliveryEngine(
      database,
      {
        pauseSession: vi.fn().mockRejectedValue(new ApiClientError(409, 'conflict')),
        getSession: vi.fn().mockResolvedValue({ id: 'session-1', status: 'paused' })
      } as never,
      { onReconciled }
    );
    await engine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect(await database.getAll('pending_mutations')).toEqual([]);
    expect(onReconciled).toHaveBeenCalledWith('session-1', 'paused');
    database.close();
  });

  it('keeps incompatible conflict state authoritative and exposes sync failure', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'resume_session');
    const onSyncError = vi.fn();
    const engine = new MutationDeliveryEngine(
      database,
      {
        resumeSession: vi.fn().mockRejectedValue(new ApiClientError(409, 'conflict')),
        getSession: vi.fn().mockResolvedValue({ id: 'session-1', status: 'paused' })
      } as never,
      { onSyncError }
    );
    await engine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect((await database.get('pending_mutations', mutation.local_operation_id))?.state).toBe(
      'failed_permanent'
    );
    expect(onSyncError).toHaveBeenCalledOnce();
    database.close();
  });

  it('uses bounded Retry-After for a retryable rate limit', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'pause_session');
    const engine = new MutationDeliveryEngine(database, {
      pauseSession: vi.fn().mockRejectedValue(new ApiClientError(429, 'rate_limited', '30'))
    } as never);
    await engine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect(
      (await database.get('pending_mutations', mutation.local_operation_id))?.next_retry_at
    ).toBe('2026-08-07T00:00:31.000Z');
    database.close();
  });

  it('keeps a transport-failed mutation pending for the next alarm delivery', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'pause_session');
    const engine = new MutationDeliveryEngine(
      database,
      {
        pauseSession: vi.fn().mockRejectedValue(new ApiClientError(0, 'network_error'))
      } as never,
      { random: () => 1 }
    );
    await engine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect(await database.get('pending_mutations', mutation.local_operation_id)).toMatchObject({
      idempotency_key: mutation.idempotency_key,
      retry_count: 1,
      next_retry_at: '2026-08-07T00:00:06.000Z',
      state: 'pending'
    });
    database.close();
  });

  it('fails safely when conflict reconciliation cannot read a valid remote session', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'pause_session');
    const onSyncError = vi.fn();
    const engine = new MutationDeliveryEngine(
      database,
      {
        pauseSession: vi.fn().mockRejectedValue(new ApiClientError(409, 'conflict')),
        getSession: vi.fn().mockRejectedValue(new ApiClientError(502, 'invalid_response_contract'))
      } as never,
      { onSyncError }
    );
    await engine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect((await database.get('pending_mutations', mutation.local_operation_id))?.state).toBe(
      'failed_permanent'
    );
    expect(onSyncError).toHaveBeenCalledWith('invalid_response_contract');
    database.close();
  });

  it('never dispatches an eighth attempt and preserves the terminal mutation', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'pause_session');
    await database.put('pending_mutations', { ...mutation, retry_count: 6 });
    const pauseSession = vi.fn().mockRejectedValue(new ApiClientError(503, 'unavailable'));
    const engine = new MutationDeliveryEngine(database, { pauseSession } as never);
    await engine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect(pauseSession).toHaveBeenCalledOnce();
    expect((await database.get('pending_mutations', mutation.local_operation_id))?.state).toBe(
      'failed_permanent'
    );
    database.close();
  });

  it('delivers a pending mutation after a new worker engine is constructed', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'complete_session');
    const completeSession = vi.fn().mockResolvedValue({ id: 'session-1', status: 'completed' });
    const restartedEngine = new MutationDeliveryEngine(database, { completeSession } as never);
    await restartedEngine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));
    expect(completeSession).toHaveBeenCalledWith('session-1', mutation.idempotency_key);
    expect(await database.getAll('pending_mutations')).toEqual([]);
    database.close();
  });

  it('replays a mutation stranded as delivering after worker recovery with its original idempotency key', async () => {
    const database = await openControlPlaneDatabase(`delivery-${crypto.randomUUID()}`);
    const mutation = await queued(database, 'pause_session');
    await database.put('pending_mutations', { ...mutation, state: 'delivering' });
    const pauseSession = vi.fn().mockResolvedValue({ id: 'session-1', status: 'paused' });
    const restartedEngine = new MutationDeliveryEngine(database, { pauseSession } as never);

    await restartedEngine.deliverDue(new Date('2026-08-07T00:00:01.000Z'));

    expect(pauseSession).toHaveBeenCalledTimes(1);
    expect(pauseSession).toHaveBeenCalledWith('session-1', mutation.idempotency_key);
    expect(await database.getAll('pending_mutations')).toEqual([]);
    database.close();
  });
});
