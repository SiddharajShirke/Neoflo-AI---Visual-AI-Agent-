import type { BrowserEventV2 } from '@visual-ai/contracts';
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from '../src/api/client.js';
import { formNextBatch } from '../src/navigation/batch-builder.js';
import { NavigationDeliveryEngine } from '../src/navigation/delivery.js';
import type { CaptureContext } from '../src/navigation/capture-gate.js';
import { CaptureGate } from '../src/navigation/capture-gate.js';
import { NavigationSessionNotRecordingReconciler } from '../src/navigation/shutdown.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';
import { overwriteNavigationBatchForTest } from './support/navigation-test-utils.js';

const context: CaptureContext = {
  generation: 1,
  deviceId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  capturePolicyVersion: 'm4-navigation-v1'
};

function draft(): Omit<BrowserEventV2, 'sequence_number'> {
  return {
    client_event_id: crypto.randomUUID(),
    event_kind: 'navigation',
    occurred_at: '2026-08-08T00:00:00.000Z',
    page_domain: 'example.com',
    transition_type: 'link',
    capture_policy_version: 'm4-navigation-v1'
  };
}

async function setup() {
  const databaseName = `navigation-delivery-${crypto.randomUUID()}`;
  const database = await openControlPlaneDatabase(databaseName);
  const repository = database.createNavigationRepository(
    () => new Date('2026-08-08T00:00:00.000Z')
  );
  await repository.openSession(context);
  await repository.appendDraft(draft(), context);
  const batch = await formNextBatch(repository, context);
  if (!batch) throw new Error('batch setup failed');
  return { database, databaseName, repository, batch };
}

describe('navigation batch delivery', () => {
  it('persists delivering before its fixed API dispatch and projects acknowledgement before delete', async () => {
    const { database, repository, batch } = await setup();
    const ingestBrowserEventBatch = vi.fn().mockImplementation(async () => {
      expect((await repository.getBatch(batch.batch_id))?.delivery_state).toBe('delivering');
      expect(await repository.listEventsForBatch(batch.batch_id)).toHaveLength(1);
      return { accepted_count: 1, duplicate_count: 0 };
    });
    const engine = new NavigationDeliveryEngine(repository, { ingestBrowserEventBatch } as never);

    await engine.deliverDue(new Date('2026-08-08T00:01:00.000Z'));

    expect(ingestBrowserEventBatch).toHaveBeenCalledWith(
      expect.objectContaining({ device_id: context.deviceId, session_id: context.sessionId }),
      batch.idempotency_key
    );
    expect(await repository.getBatch(batch.batch_id)).toBeNull();
    expect(await repository.listEventsForBatch(batch.batch_id)).toEqual([]);
    expect((await repository.getCoordinationState())?.event_count).toBe(0);
    database.close();
  });

  it('keeps batch and member events when the API acknowledgement count does not cover all members', async () => {
    const { database, repository, batch } = await setup();
    const onSyncError = vi.fn();
    const engine = new NavigationDeliveryEngine(
      repository,
      {
        ingestBrowserEventBatch: vi
          .fn()
          .mockResolvedValue({ accepted_count: 0, duplicate_count: 0 })
      } as never,
      { onSyncError }
    );

    await engine.deliverDue(new Date('2026-08-08T00:01:00.000Z'));

    expect((await repository.getBatch(batch.batch_id))?.delivery_state).toBe('failed_permanent');
    expect(await repository.listEventsForBatch(batch.batch_id)).toHaveLength(1);
    expect(onSyncError).toHaveBeenCalledWith('acknowledgement_mismatch');
    database.close();
  });

  it('does not overlap concurrent delivery loops', async () => {
    const { database, repository } = await setup();
    const wait = new Promise<void>((resolve) => setTimeout(resolve, 1));
    const ingestBrowserEventBatch = vi.fn().mockImplementation(async () => {
      await wait;
      return { accepted_count: 1, duplicate_count: 0 };
    });
    const engine = new NavigationDeliveryEngine(repository, { ingestBrowserEventBatch } as never);

    await Promise.all([
      engine.deliverDue(new Date('2026-08-08T00:01:00.000Z')),
      engine.deliverDue(new Date('2026-08-08T00:01:00.000Z'))
    ]);

    expect(ingestBrowserEventBatch).toHaveBeenCalledTimes(1);
    database.close();
  });

  it('retains a malformed immutable hash without dispatching it', async () => {
    const { database, databaseName, repository, batch } = await setup();
    const corrupt = { ...batch, canonical_request_hash: 'a'.repeat(64) };
    await overwriteNavigationBatchForTest(databaseName, corrupt);
    const ingestBrowserEventBatch = vi.fn();
    const engine = new NavigationDeliveryEngine(repository, { ingestBrowserEventBatch } as never);

    await engine.deliverDue(new Date('2026-08-08T00:01:00.000Z'));

    expect(ingestBrowserEventBatch).not.toHaveBeenCalled();
    expect((await repository.getBatch(batch.batch_id))?.delivery_state).toBe('failed_permanent');
    database.close();
  });

  it('keeps a status-0 transport failure pending with a bounded retry time', async () => {
    const { database, repository, batch } = await setup();
    const engine = new NavigationDeliveryEngine(
      repository,
      {
        ingestBrowserEventBatch: vi.fn().mockRejectedValue(new ApiClientError(0, 'network_error'))
      } as never,
      { random: () => 1 }
    );

    await engine.deliverDue(new Date('2026-08-08T00:01:00.000Z'));

    expect(await repository.getBatch(batch.batch_id)).toMatchObject({
      delivery_state: 'pending',
      retry_count: 1,
      next_retry_at: '2026-08-08T00:01:05.000Z'
    });
    database.close();
  });

  it('counts the first HTTP send as attempt one and never makes an eighth automatic send', async () => {
    const { database, repository, batch } = await setup();
    const ingestBrowserEventBatch = vi
      .fn()
      .mockRejectedValue(new ApiClientError(0, 'network_error'));
    const engine = new NavigationDeliveryEngine(repository, { ingestBrowserEventBatch } as never, {
      random: () => 1
    });
    let now = new Date('2026-08-08T00:01:00.000Z');

    for (let attempt = 1; attempt <= 7; attempt += 1) {
      await engine.deliverDue(now);
      expect(ingestBrowserEventBatch).toHaveBeenCalledTimes(attempt);
      expect((await repository.getBatch(batch.batch_id))?.retry_count).toBe(attempt);
      const next = await repository.getBatch(batch.batch_id);
      if (next?.delivery_state === 'pending') now = new Date(next.next_retry_at);
    }
    await engine.deliverDue(new Date('2026-08-08T01:00:00.000Z'));

    expect(ingestBrowserEventBatch).toHaveBeenCalledTimes(7);
    expect(await repository.getBatch(batch.batch_id)).toMatchObject({
      retry_count: 7,
      delivery_state: 'failed_permanent'
    });
    database.close();
  });

  it('recovers a stale delivering batch after worker restart without changing identity or attempt count', async () => {
    const { database, repository, batch } = await setup();
    await repository.claimBatch(batch.batch_id, new Date('2026-08-08T00:01:00.000Z'));
    const stranded = await repository.getBatch(batch.batch_id);
    const ingestBrowserEventBatch = vi
      .fn()
      .mockResolvedValue({ accepted_count: 1, duplicate_count: 0 });
    const restartedEngine = new NavigationDeliveryEngine(repository, {
      ingestBrowserEventBatch
    } as never);

    await restartedEngine.deliverDue(new Date('2026-08-08T00:01:00.000Z'));

    expect(ingestBrowserEventBatch).toHaveBeenCalledOnce();
    expect(await repository.getBatch(batch.batch_id)).toBeNull();
    expect(stranded).toMatchObject({
      batch_id: batch.batch_id,
      idempotency_key: batch.idempotency_key,
      canonical_request_hash: batch.canonical_request_hash,
      retry_count: 1
    });
    database.close();
  });

  it('caps physical POSTs at seven when retryable failures end in a refreshable 401', async () => {
    const { database, repository, batch } = await setup();
    const fetcher = vi.fn();
    for (let count = 0; count < 6; count += 1) {
      fetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'unavailable' } }), { status: 503 })
      );
    }
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'expired' } }), { status: 401 })
    );
    const refresh = vi.fn().mockResolvedValue(true);
    const authRequired = vi.fn();
    const engine = new NavigationDeliveryEngine(
      repository,
      new ApiClient('https://api.example.test', async () => 'token', refresh, fetcher),
      { random: () => 1, onAuthRequired: authRequired }
    );
    let now = new Date('2026-08-08T00:01:00.000Z');

    for (let attempt = 1; attempt <= 7; attempt += 1) {
      await engine.deliverDue(now);
      const latest = await repository.getBatch(batch.batch_id);
      if (latest?.delivery_state === 'pending') now = new Date(latest.next_retry_at);
    }
    await engine.deliverDue(new Date('2026-08-08T01:00:00.000Z'));

    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(refresh).toHaveBeenCalledOnce();
    expect(authRequired).not.toHaveBeenCalled();
    expect(await repository.getBatch(batch.batch_id)).toMatchObject({
      retry_count: 7,
      delivery_state: 'failed_permanent'
    });
    database.close();
  });

  it('uses the next physical attempt after a successful centralized refresh and resends the exact immutable batch', async () => {
    const { database, repository, batch } = await setup();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'expired' } }), { status: 401 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted_count: 1, duplicate_count: 0 }), { status: 200 })
      );
    const refresh = vi.fn().mockResolvedValue(true);
    const engine = new NavigationDeliveryEngine(
      repository,
      new ApiClient('https://api.example.test', async () => 'token', refresh, fetcher)
    );
    const now = new Date('2026-08-08T00:01:00.000Z');

    await engine.deliverDue(now);
    expect(await repository.getBatch(batch.batch_id)).toMatchObject({
      delivery_state: 'pending',
      retry_count: 1,
      next_retry_at: now.toISOString()
    });
    expect(fetcher).toHaveBeenCalledOnce();

    await engine.deliverDue(now);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
    const [firstUrl, firstInit] = fetcher.mock.calls[0] as [string, RequestInit];
    const [secondUrl, secondInit] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toBe(firstUrl);
    expect(secondInit.body).toBe(firstInit.body);
    expect((secondInit.headers as Record<string, string>)['Idempotency-Key']).toBe(
      (firstInit.headers as Record<string, string>)['Idempotency-Key']
    );
    expect(await repository.getBatch(batch.batch_id)).toBeNull();
    database.close();
  });

  it('awaits the centralized authentication shutdown after a final browser-event 401', async () => {
    const { database, repository, batch } = await setup();
    let signalShutdownStarted: (() => void) | undefined;
    const shutdownStarted = new Promise<void>((resolve) => {
      signalShutdownStarted = resolve;
    });
    let releaseShutdown: (() => void) | undefined;
    const shutdown = new Promise<void>((resolve) => {
      releaseShutdown = resolve;
    });
    let completed = false;
    const engine = new NavigationDeliveryEngine(
      repository,
      {
        ingestBrowserEventBatch: vi
          .fn()
          .mockRejectedValue(new ApiClientError(401, 'authentication_required'))
      } as never,
      {
        onAuthRequired: async () => {
          signalShutdownStarted?.();
          await shutdown;
          completed = true;
        }
      }
    );

    const delivery = engine.deliverDue(new Date('2026-08-08T00:01:00.000Z'));
    await shutdownStarted;
    let settled = false;
    void delivery.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    releaseShutdown?.();
    await delivery;

    expect(completed).toBe(true);
    expect(await repository.getBatch(batch.batch_id)).toMatchObject({
      delivery_state: 'blocked_auth',
      retry_count: 1
    });
    database.close();
  });

  it('holds a session_not_recording batch until reconciliation confirms recording, then retries its exact immutable batch', async () => {
    const { database, repository, batch } = await setup();
    const ingestBrowserEventBatch = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(409, 'session_not_recording'))
      .mockResolvedValueOnce({ accepted_count: 1, duplicate_count: 0 });
    const onSessionNotRecording = vi.fn().mockResolvedValue('retry');
    const onRetryScheduled = vi.fn(async () => undefined);
    const engine = new NavigationDeliveryEngine(
      repository,
      { ingestBrowserEventBatch } as never,
      { onSessionNotRecording, onRetryScheduled } as never
    );
    const now = new Date('2026-08-08T00:01:00.000Z');

    await engine.deliverDue(now);

    expect(onSessionNotRecording).toHaveBeenCalledExactlyOnceWith(context.sessionId);
    expect(onRetryScheduled).toHaveBeenCalledOnce();
    expect(await repository.getBatch(batch.batch_id)).toMatchObject({
      delivery_state: 'pending',
      retry_count: 1,
      batch_id: batch.batch_id,
      idempotency_key: batch.idempotency_key,
      canonical_request_hash: batch.canonical_request_hash,
      event_ids: batch.event_ids
    });
    expect(ingestBrowserEventBatch).toHaveBeenCalledOnce();

    await engine.deliverDue(now);

    expect(ingestBrowserEventBatch).toHaveBeenCalledTimes(2);
    expect(await repository.getBatch(batch.batch_id)).toBeNull();
    database.close();
  });

  it('keeps a session_not_recording batch recoverably reconciling after authority lookup failure without a blind resend', async () => {
    const { database, repository, batch } = await setup();
    const ingestBrowserEventBatch = vi
      .fn()
      .mockRejectedValue(new ApiClientError(409, 'session_not_recording'));
    const onSessionNotRecording = vi.fn().mockRejectedValue(new Error('offline'));
    const onSyncError = vi.fn();
    const engine = new NavigationDeliveryEngine(
      repository,
      { ingestBrowserEventBatch } as never,
      { onSessionNotRecording, onSyncError } as never
    );
    const now = new Date('2026-08-08T00:01:00.000Z');

    await expect(engine.deliverDue(now)).resolves.toBeUndefined();
    await expect(engine.deliverDue(now)).resolves.toBeUndefined();

    expect(ingestBrowserEventBatch).toHaveBeenCalledOnce();
    expect(onSessionNotRecording).toHaveBeenCalledTimes(2);
    expect(onSyncError).toHaveBeenLastCalledWith('session_not_recording_reconciliation_failed');
    expect(await repository.getBatch(batch.batch_id)).toMatchObject({
      delivery_state: 'reconciling',
      retry_count: 1
    });
    database.close();
  });

  it.each([null, 'legacy-policy-v1'] as const)(
    'does not resend after session_not_recording recording authority has policy %s',
    async (capturePolicyVersion) => {
      const { database, repository, batch } = await setup();
      const gate = new CaptureGate();
      gate.open(context);
      const ingestBrowserEventBatch = vi
        .fn()
        .mockRejectedValue(new ApiClientError(409, 'session_not_recording'));
      const onCapturePolicyMismatch = vi.fn(async () => undefined);
      const reconciler = new NavigationSessionNotRecordingReconciler(
        gate,
        repository,
        {
          getSession: vi.fn().mockResolvedValue({
            id: context.sessionId,
            status: 'recording',
            capturePolicyVersion
          })
        },
        { onCapturePolicyMismatch }
      );
      const engine = new NavigationDeliveryEngine(
        repository,
        { ingestBrowserEventBatch } as never,
        { onSessionNotRecording: (sessionId) => reconciler.reconcile(sessionId) }
      );

      await engine.deliverDue(new Date('2026-08-08T00:01:00.000Z'));
      await engine.deliverDue(new Date('2026-08-08T00:02:00.000Z'));

      expect(ingestBrowserEventBatch).toHaveBeenCalledOnce();
      expect(onCapturePolicyMismatch).toHaveBeenCalledExactlyOnceWith(context.sessionId);
      expect(gate.acquire()).toBeNull();
      expect(await repository.getBatch(batch.batch_id)).toBeNull();
      expect(await repository.listEventsForBatch(batch.batch_id)).toEqual([]);
      database.close();
    }
  );

  it.each(['device_revoked', 'consent_inactive', 'capture_policy_mismatch'] as const)(
    'routes typed M4-A %s outcomes once without a generic retry',
    async (code) => {
      const { database, repository, batch } = await setup();
      const onAuthorityOutcome = vi.fn();
      const onSyncError = vi.fn();
      const engine = new NavigationDeliveryEngine(
        repository,
        {
          ingestBrowserEventBatch: vi.fn().mockRejectedValue(new ApiClientError(409, code))
        } as never,
        { onAuthorityOutcome, onSyncError }
      );

      await engine.deliverDue(new Date('2026-08-08T00:01:00.000Z'));

      expect(onAuthorityOutcome).toHaveBeenCalledExactlyOnceWith(code, context.sessionId);
      expect(onSyncError).not.toHaveBeenCalled();
      expect(await repository.getBatch(batch.batch_id)).toMatchObject({
        delivery_state: 'failed_permanent',
        retry_count: 1
      });
      database.close();
    }
  );
});
