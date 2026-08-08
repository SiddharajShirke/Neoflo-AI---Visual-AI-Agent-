import { describe, expect, it, vi } from 'vitest';
import { CaptureGate } from '../src/navigation/capture-gate.js';
import {
  NavigationSessionNotRecordingReconciler,
  NavigationSessionInvalidator,
  type NavigationInvalidationReason
} from '../src/navigation/shutdown.js';

const context = {
  deviceId: 'device-1',
  sessionId: 'session-1',
  capturePolicyVersion: 'm4-navigation-v1' as const
};

describe('navigation session invalidation', () => {
  it.each([
    'authentication_required',
    'device_revoked',
    'consent_inactive',
    'capture_policy_mismatch'
  ] as const)(
    'closes and purges before handling %s',
    async (reason: NavigationInvalidationReason) => {
      const gate = new CaptureGate();
      gate.open(context);
      const order: string[] = [];
      const invalidate = new NavigationSessionInvalidator(
        gate,
        {
          purgeSession: vi.fn(async () => {
            expect(gate.acquire()).toBeNull();
            order.push('purge');
          })
        },
        {
          onAuthenticationRequired: async () => {
            order.push('sign-out');
          },
          onSafeState: async () => {
            order.push('safe-state');
          }
        }
      );

      await invalidate.invalidate(context.sessionId, reason);

      expect(order).toEqual(
        reason === 'authentication_required'
          ? ['purge', 'sign-out', 'safe-state']
          : ['purge', 'safe-state']
      );
      expect(gate.acquire()).toBeNull();
    }
  );

  it.each(['paused', 'completed', 'cancelled'] as const)(
    'reconciles session_not_recording once and purges a server-%s session',
    async (status) => {
      const gate = new CaptureGate();
      gate.open(context);
      const purgeSession = vi.fn(async () => undefined);
      const projectRemoteState = vi.fn(async () => undefined);
      const safeSyncError = vi.fn(async () => undefined);
      const getSession = vi.fn().mockResolvedValue({
        id: context.sessionId,
        status,
        capturePolicyVersion: 'm4-navigation-v1'
      });
      const reconciler = new NavigationSessionNotRecordingReconciler(
        gate,
        { purgeSession },
        { getSession } as never,
        { projectRemoteState, safeSyncError }
      );

      await expect(reconciler.reconcile(context.sessionId)).resolves.toBe('purged');

      expect(getSession).toHaveBeenCalledOnce();
      expect(purgeSession).toHaveBeenCalledExactlyOnceWith(context.sessionId);
      expect(projectRemoteState).toHaveBeenCalledExactlyOnceWith(status);
      expect(safeSyncError).not.toHaveBeenCalled();
    }
  );

  it('keeps a freshly reconciled recording batch for explicit retry without a reconciliation loop', async () => {
    const gate = new CaptureGate();
    gate.open(context);
    const purgeSession = vi.fn(async () => undefined);
    const safeSyncError = vi.fn(async () => undefined);
    const getSession = vi.fn().mockResolvedValue({
      id: context.sessionId,
      status: 'recording',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    const reconciler = new NavigationSessionNotRecordingReconciler(
      gate,
      { purgeSession },
      { getSession } as never,
      { safeSyncError }
    );

    await expect(reconciler.reconcile(context.sessionId)).resolves.toBe('retry');

    expect(getSession).toHaveBeenCalledOnce();
    expect(purgeSession).not.toHaveBeenCalled();
    expect(safeSyncError).toHaveBeenCalledExactlyOnceWith('session_not_recording');
  });

  it.each([null, 'legacy-policy-v1'] as const)(
    'fails closed when recording authority has policy %s',
    async (capturePolicyVersion) => {
      const gate = new CaptureGate();
      gate.open(context);
      const purgeSession = vi.fn(async () => undefined);
      const onCapturePolicyMismatch = vi.fn(async () => undefined);
      const reconciler = new NavigationSessionNotRecordingReconciler(
        gate,
        { purgeSession },
        {
          getSession: vi.fn().mockResolvedValue({
            id: context.sessionId,
            status: 'recording',
            capturePolicyVersion
          })
        } as never,
        { onCapturePolicyMismatch }
      );

      await expect(reconciler.reconcile(context.sessionId)).resolves.toBe('purged');

      expect(gate.acquire()).toBeNull();
      expect(purgeSession).toHaveBeenCalledExactlyOnceWith(context.sessionId);
      expect(onCapturePolicyMismatch).toHaveBeenCalledExactlyOnceWith(context.sessionId);
    }
  );
});
