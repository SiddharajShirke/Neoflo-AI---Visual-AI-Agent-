import type { CaptureGate } from './capture-gate.js';
import type { NavigationSessionNotRecordingResolution } from './delivery.js';

export type NavigationInvalidationReason =
  | 'authentication_required'
  | 'device_revoked'
  | 'consent_inactive'
  | 'capture_policy_mismatch';

export interface NavigationInvalidationHooks {
  onAuthenticationRequired?: () => Promise<void>;
  onSafeState?: (reason: NavigationInvalidationReason) => Promise<void>;
}

type ReconciledSessionStatus = 'recording' | 'paused' | 'completed' | 'cancelled';

export interface NavigationSessionNotRecordingHooks {
  projectRemoteState?: (status: ReconciledSessionStatus) => Promise<void>;
  safeSyncError?: (code: 'session_not_recording') => Promise<void>;
  onCapturePolicyMismatch?: (sessionId: string) => Promise<void>;
}

/** Worker-owned authority-loss boundary: close, drain, purge, then project safe state. */
export class NavigationSessionInvalidator {
  constructor(
    private readonly gate: CaptureGate,
    private readonly repository: { purgeSession(sessionId: string): Promise<void> },
    private readonly hooks: NavigationInvalidationHooks = {}
  ) {}

  async invalidate(sessionId: string, reason: NavigationInvalidationReason): Promise<void> {
    await this.gate.closeAndDrain();
    await this.repository.purgeSession(sessionId);
    if (reason === 'authentication_required') await this.hooks.onAuthenticationRequired?.();
    await this.hooks.onSafeState?.(reason);
  }
}

/** A 409 session_not_recording is reconciled before any further event send. */
export class NavigationSessionNotRecordingReconciler {
  constructor(
    private readonly gate: CaptureGate,
    private readonly repository: { purgeSession(sessionId: string): Promise<void> },
    private readonly api: {
      getSession(sessionId: string): Promise<{
        id: string;
        status: ReconciledSessionStatus;
        capturePolicyVersion: string | null;
      }>;
    },
    private readonly hooks: NavigationSessionNotRecordingHooks = {}
  ) {}

  async reconcile(sessionId: string): Promise<NavigationSessionNotRecordingResolution> {
    await this.gate.closeAndDrain();
    const remote = await this.api.getSession(sessionId);
    if (remote.status === 'recording' && remote.capturePolicyVersion === 'm4-navigation-v1') {
      await this.hooks.safeSyncError?.('session_not_recording');
      return 'retry';
    }
    await this.repository.purgeSession(sessionId);
    if (remote.status === 'recording') {
      await this.hooks.onCapturePolicyMismatch?.(sessionId);
      return 'purged';
    }
    await this.hooks.projectRemoteState?.(remote.status);
    return 'purged';
  }
}
