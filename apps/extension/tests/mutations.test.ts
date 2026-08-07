import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createPendingMutation, enqueueMutation } from '../src/queue/mutations.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';

describe('durable control-plane mutations', () => {
  it('creates a minimal, hash-bound non-secret mutation', async () => {
    const mutation = await createPendingMutation(
      'pause_session',
      { session_id: 'session-1' },
      new Date('2026-08-07T00:00:00.000Z'),
      () => 'operation-1',
      async () => 'a'.repeat(64)
    );
    expect(mutation).toEqual({
      local_operation_id: 'operation-1',
      idempotency_key: 'operation-1',
      operation_type: 'pause_session',
      payload: { session_id: 'session-1' },
      payload_sha256: 'a'.repeat(64),
      created_at: '2026-08-07T00:00:00.000Z',
      retry_count: 0,
      next_retry_at: '2026-08-07T00:00:00.000Z',
      state: 'pending'
    });
    expect(JSON.stringify(mutation)).not.toMatch(/authorization|token|password/i);
  });

  it('uses the operation id as the durable key and avoids duplicate enqueue', async () => {
    const database = await openControlPlaneDatabase(`queue-${crypto.randomUUID()}`);
    const mutation = await createPendingMutation('complete_session', { session_id: 's1' });
    expect(await enqueueMutation(database, mutation)).toBe(true);
    expect(await enqueueMutation(database, mutation)).toBe(false);
    expect(await database.getAll('pending_mutations')).toHaveLength(1);
    database.close();
  });
});
