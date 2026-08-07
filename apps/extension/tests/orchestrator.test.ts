import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneOrchestrator } from '../src/core/orchestrator.js';
import type { MonitoringState, MonitoringStateKind } from '../src/core/state-machine.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';
import { createPendingMutation, enqueueMutation } from '../src/queue/mutations.js';

describe('control-plane orchestration', () => {
  const allStates: MonitoringStateKind[] = [
    'UNCONFIGURED',
    'SIGNED_OUT',
    'READY',
    'STARTING',
    'RECORDING',
    'PAUSING',
    'PAUSED',
    'RESUMING',
    'STOPPING',
    'STOPPED',
    'OFFLINE_BUFFERING',
    'SYNC_ERROR'
  ];
  const actions = ['start', 'pause', 'resume', 'stop'] as const;
  const supportedActions: Partial<
    Record<MonitoringStateKind, readonly (typeof actions)[number][]>
  > = {
    READY: ['start'],
    RECORDING: ['pause', 'stop'],
    PAUSED: ['resume', 'stop']
  };

  it.each(
    allStates.flatMap((kind) =>
      actions
        .filter((action) => !supportedActions[kind]?.includes(action))
        .map((action) => [kind, action] as const)
    )
  )('rejects %s -> %s without making an API call', async (kind, action) => {
    const api = {
      createSession: vi.fn(),
      pauseSession: vi.fn(),
      resumeSession: vi.fn(),
      completeSession: vi.fn()
    };
    const orchestrator = new ControlPlaneOrchestrator(
      api as never,
      {
        get: vi.fn(),
        put: vi.fn()
      } as never
    );
    const state: MonitoringState = {
      kind,
      sessionId: 'session-1',
      consentActive: true,
      errorCode: null
    };
    (orchestrator as unknown as { state: MonitoringState }).state = state;

    await expect(orchestrator[action]()).resolves.toBe(false);
    expect(orchestrator.snapshot()).toEqual(state);
    expect(Object.values(api).every((method) => method.mock.calls.length === 0)).toBe(true);
  });

  it('does not call the API when Start is invalid without monitoring consent', async () => {
    const createSession = vi.fn();
    const orchestrator = new ControlPlaneOrchestrator(
      { createSession } as never,
      { get: vi.fn(), put: vi.fn() } as never
    );
    await expect(orchestrator.start()).resolves.toBe(false);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('reconciles an active session after a worker restart instead of assuming it stopped', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ id: 'current', device_id: 'device-1' })
      .mockResolvedValueOnce({ id: 'monitoring-consent', consent_id: 'consent-1', granted: true })
      .mockResolvedValueOnce({ id: 'current', session_id: 'session-1', status: 'recording' });
    const orchestrator = new ControlPlaneOrchestrator(
      { getSession: vi.fn().mockResolvedValue({ id: 'session-1', status: 'paused' }) } as never,
      { get, put: vi.fn() } as never
    );
    await expect(orchestrator.initialize(true)).resolves.toMatchObject({
      kind: 'PAUSED',
      sessionId: 'session-1'
    });
  });

  it('keeps a stale active session in sync error when restart reconciliation cannot reach the server', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ id: 'current', device_id: 'device-1' })
      .mockResolvedValueOnce({ id: 'monitoring-consent', consent_id: 'consent-1', granted: true })
      .mockResolvedValueOnce({ id: 'current', session_id: 'session-1', status: 'recording' });
    const orchestrator = new ControlPlaneOrchestrator(
      { getSession: vi.fn().mockRejectedValue(new Error('offline')) } as never,
      { get, put: vi.fn() } as never
    );
    await expect(orchestrator.initialize(true)).resolves.toMatchObject({
      kind: 'SYNC_ERROR',
      sessionId: 'session-1'
    });
  });

  it('keeps one installation identity and device registration across restarts', async () => {
    const database = await openControlPlaneDatabase(`orchestrator-${crypto.randomUUID()}`);
    const registerDevice = vi.fn().mockResolvedValue({ id: 'device-1' });
    const first = new ControlPlaneOrchestrator({ registerDevice } as never, database);
    expect(await first.registerDevice()).toBe('device-1');
    const second = new ControlPlaneOrchestrator({ registerDevice } as never, database);
    expect(await second.registerDevice()).toBe('device-1');
    expect(registerDevice).toHaveBeenCalledOnce();
    expect((await database.get('device_metadata', 'current'))?.installation_id).toBeTruthy();
    database.close();
  });

  it('grants and withdraws monitoring consent while Start needs no capture consent', async () => {
    const database = await openControlPlaneDatabase(`orchestrator-${crypto.randomUUID()}`);
    const createConsent = vi
      .fn()
      .mockResolvedValueOnce({ id: 'consent-1' })
      .mockResolvedValueOnce({ id: 'consent-2' });
    const createSession = vi.fn().mockResolvedValue({ id: 'session-1', status: 'recording' });
    const orchestrator = new ControlPlaneOrchestrator(
      {
        registerDevice: vi.fn().mockResolvedValue({ id: 'device-1' }),
        createConsent,
        createSession
      } as never,
      database
    );
    await orchestrator.initialize(true);
    await orchestrator.registerDevice();
    expect(await orchestrator.setMonitoringConsent(true)).toBe(true);
    expect(await orchestrator.start()).toBe(true);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshot_consent_id: null,
        capture_policy_version: 'm3-capture-v1'
      }),
      expect.any(String)
    );
    expect(await orchestrator.setMonitoringConsent(false)).toBe(true);
    expect(orchestrator.snapshot()).toMatchObject({ kind: 'READY', consentActive: false });
    database.close();
  });

  it('recovers a no-auth restart as signed out and remote completion as stopped', async () => {
    const noAuth = new ControlPlaneOrchestrator(
      {} as never,
      { get: vi.fn(), put: vi.fn() } as never
    );
    await expect(noAuth.initialize(false)).resolves.toMatchObject({ kind: 'SIGNED_OUT' });

    const get = vi
      .fn()
      .mockResolvedValueOnce({ id: 'current', device_id: 'device-1' })
      .mockResolvedValueOnce({ id: 'monitoring-consent', consent_id: 'consent-1', granted: true })
      .mockResolvedValueOnce({ id: 'current', session_id: 'session-1', status: 'recording' });
    const completed = new ControlPlaneOrchestrator(
      { getSession: vi.fn().mockResolvedValue({ id: 'session-1', status: 'completed' }) } as never,
      { get, put: vi.fn() } as never
    );
    await expect(completed.initialize(true)).resolves.toMatchObject({ kind: 'STOPPED' });
  });

  it('keeps an authenticated READY restart ready without querying a session', async () => {
    const getSession = vi.fn();
    const get = vi.fn().mockResolvedValue(undefined);
    const orchestrator = new ControlPlaneOrchestrator(
      { getSession } as never,
      { get, put: vi.fn() } as never
    );
    await expect(orchestrator.initialize(true)).resolves.toMatchObject({ kind: 'READY' });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('preserves unresolved mutations when a restarted worker has no authentication', async () => {
    const database = await openControlPlaneDatabase(`orchestrator-${crypto.randomUUID()}`);
    const mutation = await createPendingMutation('pause_session', { session_id: 'session-1' });
    await enqueueMutation(database, mutation);
    const orchestrator = new ControlPlaneOrchestrator({} as never, database);
    await expect(orchestrator.initialize(false)).resolves.toMatchObject({ kind: 'SIGNED_OUT' });
    expect(await database.get('pending_mutations', mutation.local_operation_id)).toMatchObject({
      state: 'pending'
    });
    database.close();
  });

  it('reconciles a persisted paused session with the remote state before returning controls', async () => {
    const getSession = vi.fn().mockResolvedValue({ id: 'session-1', status: 'paused' });
    const get = vi
      .fn()
      .mockResolvedValueOnce({ id: 'current', device_id: 'device-1' })
      .mockResolvedValueOnce({ id: 'monitoring-consent', consent_id: 'consent-1', granted: true })
      .mockResolvedValueOnce({ id: 'current', session_id: 'session-1', status: 'paused' });
    const orchestrator = new ControlPlaneOrchestrator(
      { getSession } as never,
      { get, put: vi.fn() } as never
    );
    await expect(orchestrator.initialize(true)).resolves.toMatchObject({ kind: 'PAUSED' });
    expect(getSession).toHaveBeenCalledWith('session-1');
  });
});
