import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneOrchestrator } from '../src/core/orchestrator.js';
import { CaptureGate } from '../src/navigation/capture-gate.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';

describe('navigation startup recovery', () => {
  it('recovers navigation delivery before authenticated reconciliation and opens only a reconciled M4 recording session', async () => {
    const database = await openControlPlaneDatabase(`navigation-startup-${crypto.randomUUID()}`);
    await database.put('device_metadata', { id: 'current', device_id: 'device-1' });
    await database.put('extension_config', {
      id: 'monitoring-consent',
      consent_id: 'consent-1',
      granted: true
    });
    await database.put('monitoring_sessions', {
      id: 'current',
      session_id: 'session-1',
      status: 'recording',
      capture_policy_version: 'm4-navigation-v1'
    });
    const gate = new CaptureGate();
    const repository = database.createNavigationRepository();
    const recovered = vi.spyOn(repository, 'recoverStaleDelivering').mockResolvedValue();
    const scheduled = vi.fn(async () => undefined);
    const api = {
      getSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        status: 'recording',
        capturePolicyVersion: 'm4-navigation-v1'
      })
    };
    const orchestrator = new ControlPlaneOrchestrator(api as never, database, {
      gate,
      repository,
      schedulePendingDelivery: scheduled
    });

    await expect(orchestrator.initialize(true)).resolves.toMatchObject({ kind: 'RECORDING' });

    expect(recovered).toHaveBeenCalledBefore(api.getSession as never);
    expect(gate.acquire()?.context).toMatchObject({
      deviceId: 'device-1',
      sessionId: 'session-1',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    expect(scheduled).toHaveBeenCalledOnce();
    database.close();
  });

  it('recovers stale navigation batches but keeps the gate closed without authentication or a proven M4 policy', async () => {
    const database = await openControlPlaneDatabase(`navigation-startup-${crypto.randomUUID()}`);
    const gate = new CaptureGate();
    const repository = database.createNavigationRepository();
    const recovered = vi.spyOn(repository, 'recoverStaleDelivering').mockResolvedValue();
    const scheduled = vi.fn(async () => undefined);
    const orchestrator = new ControlPlaneOrchestrator({} as never, database, {
      gate,
      repository,
      schedulePendingDelivery: scheduled
    });

    await expect(orchestrator.initialize(false)).resolves.toMatchObject({ kind: 'SIGNED_OUT' });

    expect(recovered).toHaveBeenCalledOnce();
    expect(gate.acquire()).toBeNull();
    expect(scheduled).not.toHaveBeenCalled();
    database.close();
  });

  it('does not open from a cached local policy when fresh remote authority does not confirm M4', async () => {
    const database = await openControlPlaneDatabase(`navigation-startup-${crypto.randomUUID()}`);
    await database.put('device_metadata', { id: 'current', device_id: 'device-1' });
    await database.put('extension_config', {
      id: 'monitoring-consent',
      consent_id: 'consent-1',
      granted: true
    });
    await database.put('monitoring_sessions', {
      id: 'current',
      session_id: 'session-1',
      status: 'recording',
      capture_policy_version: 'm4-navigation-v1'
    });
    const gate = new CaptureGate();
    const repository = database.createNavigationRepository();
    const orchestrator = new ControlPlaneOrchestrator(
      {
        getSession: vi.fn().mockResolvedValue({
          id: 'session-1',
          status: 'recording',
          capturePolicyVersion: 'legacy-policy-v1'
        })
      } as never,
      database,
      { gate, repository, schedulePendingDelivery: vi.fn(async () => undefined) }
    );

    await expect(orchestrator.initialize(true)).resolves.toMatchObject({ kind: 'RECORDING' });

    expect(gate.acquire()).toBeNull();
    database.close();
  });

  it('restores a durable pause intent before capture and authorizes its control transition only through the drain dependency', async () => {
    const database = await openControlPlaneDatabase(`navigation-startup-${crypto.randomUUID()}`);
    await database.put('device_metadata', { id: 'current', device_id: 'device-1' });
    await database.put('extension_config', {
      id: 'monitoring-consent',
      consent_id: 'consent-1',
      granted: true
    });
    await database.put('monitoring_sessions', {
      id: 'current',
      session_id: 'session-1',
      status: 'recording',
      capture_policy_version: 'm4-navigation-v1'
    });
    const gate = new CaptureGate();
    const repository = database.createNavigationRepository();
    const openContext = gate.open({
      deviceId: 'device-1',
      sessionId: 'session-1',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(openContext);
    await repository.closeForLifecycle('session-1', 'pause');
    const continuePersisted = vi.fn(async (_id, _context, _intent, send) => send());
    const pauseSession = vi.fn().mockResolvedValue({ id: 'session-1', status: 'paused' });
    const orchestrator = new ControlPlaneOrchestrator(
      {
        getSession: vi.fn().mockResolvedValue({ id: 'session-1', status: 'recording' }),
        pauseSession
      } as never,
      database,
      { gate, repository, schedulePendingDelivery: vi.fn(async () => undefined) },
      { requestPause: vi.fn(), requestStop: vi.fn(), continuePersisted }
    );

    await orchestrator.initialize(true);

    expect(continuePersisted).toHaveBeenCalledOnce();
    expect(pauseSession).toHaveBeenCalledOnce();
    expect(gate.acquire()).toBeNull();
    database.close();
  });
});
