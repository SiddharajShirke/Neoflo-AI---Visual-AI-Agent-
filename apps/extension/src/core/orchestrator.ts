import type { ApiClient } from '../api/client.js';
import { ApiClientError } from '../api/client.js';
import type { ControlPlaneDatabase } from '../persistence/database.js';
import {
  createPendingMutation,
  enqueueMutation,
  type ControlPlaneMutationType,
  type PendingMutation
} from '../queue/mutations.js';
import { nextRetryDelayMs, shouldRetryStatus } from '../queue/retry.js';
import { CaptureGate } from '../navigation/capture-gate.js';
import type { NavigationRepository } from '../navigation/navigation-repository.js';
import {
  initialMonitoringState,
  reduceMonitoring,
  type MonitoringState,
  type RemoteSessionStatus
} from './state-machine.js';

const CONSENT_POLICY_VERSION = 'm3-monitoring-v1';
const CAPTURE_POLICY_VERSION = 'm4-navigation-v1';
const NAVIGATION_CAPTURE_POLICY_VERSION = 'm4-navigation-v1';

export interface NavigationStartupDependencies {
  gate: CaptureGate;
  repository: Pick<
    NavigationRepository,
    'recoverStaleDelivering' | 'openSession' | 'getCoordinationState' | 'getLifecycleIntent'
  >;
  schedulePendingDelivery: () => Promise<void>;
}

export interface NavigationLifecycleDependencies {
  requestPause(sessionId: string, sendPause: () => Promise<boolean>): Promise<boolean>;
  requestStop(sessionId: string, sendComplete: () => Promise<boolean>): Promise<boolean>;
  continuePersisted(
    sessionId: string,
    context: {
      generation: number;
      deviceId: string;
      sessionId: string;
      capturePolicyVersion: 'm4-navigation-v1';
    },
    intent: 'pause' | 'complete',
    sendControl: () => Promise<boolean>
  ): Promise<boolean>;
}

export class ControlPlaneOrchestrator {
  private state: MonitoringState = initialMonitoringState;
  private deviceId: string | null = null;
  private consentId: string | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly database: ControlPlaneDatabase,
    private readonly navigation?: NavigationStartupDependencies,
    private readonly lifecycle?: NavigationLifecycleDependencies
  ) {}

  snapshot(): MonitoringState {
    return { ...this.state };
  }

  async applyReconciledSessionStatus(
    sessionId: string,
    status: RemoteSessionStatus
  ): Promise<void> {
    const current = await this.database.get<{
      id: string;
      session_id?: string;
      capture_policy_version?: string;
    }>('monitoring_sessions', 'current');
    await this.projectSession(
      sessionId,
      status,
      current?.session_id === sessionId ? current.capture_policy_version : undefined
    );
  }

  async applyDeliveredMutation(mutation: PendingMutation, response: unknown): Promise<void> {
    if (
      !response ||
      typeof response !== 'object' ||
      typeof (response as { id?: unknown }).id !== 'string'
    )
      throw new Error('invalid_delivery_response');
    const id = (response as { id: string }).id;
    if (mutation.operation_type === 'register_device') {
      const installationId = mutation.payload.installation_id;
      if (typeof installationId !== 'string') throw new Error('invalid_queue_payload');
      await this.projectDevice(installationId, id);
      this.state = reduceMonitoring(this.state, {
        type: 'READY',
        consentActive: Boolean(this.consentId)
      });
      return;
    }
    if (mutation.operation_type === 'create_consent') {
      const granted = mutation.payload.granted;
      if (typeof granted !== 'boolean') throw new Error('invalid_queue_payload');
      await this.projectConsent(id, granted);
      return;
    }
    const status = (response as { status?: unknown }).status;
    if (!isRemoteSessionStatus(status)) throw new Error('invalid_delivery_response');
    const queuedPolicy = mutation.payload.capture_policy_version;
    await this.projectSession(
      id,
      status,
      typeof queuedPolicy === 'string' ? queuedPolicy : undefined
    );
    if (
      this.navigation &&
      this.deviceId &&
      (mutation.operation_type === 'create_session' || mutation.operation_type === 'resume_session')
    ) {
      try {
        const remote = await this.api.getSession(id);
        if (
          remote.status !== 'recording' ||
          remote.capturePolicyVersion !== NAVIGATION_CAPTURE_POLICY_VERSION
        ) {
          await this.navigation.gate.close();
          this.state = reduceMonitoring(this.state, {
            type: 'SYNC_ERROR',
            code: 'queued_resume_reconciliation_failed'
          });
          return;
        }
        await this.openNavigationCapture(this.deviceId, remote.id);
      } catch {
        await this.navigation.gate.close();
        this.state = reduceMonitoring(this.state, {
          type: 'SYNC_ERROR',
          code: 'queued_resume_reconciliation_failed'
        });
      }
    }
  }

  async initialize(authenticated: boolean): Promise<MonitoringState> {
    await this.navigation?.repository.recoverStaleDelivering();
    if (!authenticated) {
      await this.navigation?.gate.close();
      this.state = reduceMonitoring(this.state, { type: 'SIGNED_OUT' });
      return this.snapshot();
    }
    const device = await this.database.get<{ id: string; device_id?: string }>(
      'device_metadata',
      'current'
    );
    if (device?.device_id) this.deviceId = device.device_id;
    const consent = await this.database.get<{ id: string; consent_id?: string; granted?: boolean }>(
      'extension_config',
      'monitoring-consent'
    );
    this.consentId = consent?.granted ? (consent.consent_id ?? null) : null;
    this.state = reduceMonitoring(this.state, {
      type: 'READY',
      consentActive: Boolean(this.consentId)
    });
    const session = await this.database.get<{
      id: string;
      session_id?: string;
      status?: 'recording' | 'paused';
      capture_policy_version?: string;
    }>('monitoring_sessions', 'current');
    let remoteCapturePolicyVersion: string | null = null;
    if (session?.session_id && (session.status === 'recording' || session.status === 'paused')) {
      this.state = reduceMonitoring(this.state, {
        type: 'REMOTE_CONFIRMED',
        status: session.status,
        sessionId: session.session_id
      });
      try {
        const remote = await this.api.getSession(session.session_id);
        remoteCapturePolicyVersion = remote.capturePolicyVersion;
        this.state = reduceMonitoring(this.state, {
          type: 'REMOTE_CONFIRMED',
          status: remote.status,
          sessionId: remote.id
        });
        await this.database.put('monitoring_sessions', {
          id: 'current',
          session_id: remote.id,
          status: remote.status,
          device_id: this.deviceId,
          capture_policy_version: session.capture_policy_version
        });
      } catch {
        this.state = reduceMonitoring(this.state, {
          type: 'SYNC_ERROR',
          code: 'restart_reconciliation_failed'
        });
      }
    }
    const navigationSessionId = session?.session_id;
    const navigationDeviceId = this.deviceId;
    const lifecycleIntent = navigationSessionId
      ? await this.navigation?.repository.getLifecycleIntent(navigationSessionId)
      : null;
    if (
      lifecycleIntent !== null &&
      lifecycleIntent !== undefined &&
      navigationSessionId &&
      navigationDeviceId &&
      this.navigation &&
      this.lifecycle
    ) {
      await this.navigation.gate.close();
      const coordination = await this.navigation.repository.getCoordinationState();
      if (coordination?.buffer_session_id !== navigationSessionId) return this.snapshot();
      const completed = await this.lifecycle.continuePersisted(
        navigationSessionId,
        {
          generation: coordination.gate_generation,
          deviceId: navigationDeviceId,
          sessionId: navigationSessionId,
          capturePolicyVersion: NAVIGATION_CAPTURE_POLICY_VERSION
        },
        lifecycleIntent,
        () =>
          this.dispatchTransition(
            navigationSessionId,
            lifecycleIntent === 'pause' ? 'pause' : 'complete'
          )
      );
      if (!completed) this.state = reduceMonitoring(this.state, { type: 'OFFLINE_BUFFERING' });
      return this.snapshot();
    }
    const canOpenNavigationCapture =
      this.state.kind === 'RECORDING' &&
      typeof navigationSessionId === 'string' &&
      remoteCapturePolicyVersion === NAVIGATION_CAPTURE_POLICY_VERSION &&
      navigationDeviceId !== null;
    if (canOpenNavigationCapture) {
      await this.openNavigationCapture(navigationDeviceId, navigationSessionId);
    } else {
      await this.navigation?.gate.close();
    }
    return this.snapshot();
  }

  async registerDevice(): Promise<string | null> {
    const saved = await this.database.get<{
      id: string;
      installation_id: string;
      device_id?: string;
    }>('device_metadata', 'current');
    if (saved?.device_id) {
      this.deviceId = saved.device_id;
      return saved.device_id;
    }
    const installationId = saved?.installation_id ?? crypto.randomUUID();
    // Installation identity is durable before any network attempt; it is not a hardware fingerprint.
    await this.database.put('device_metadata', {
      id: 'current',
      installation_id: installationId,
      device_id: saved?.device_id
    });
    const payload = { installation_id: installationId, client_version: 'm3' };
    const mutation = await createPendingMutation('register_device', payload);
    let response;
    try {
      response = await this.api.registerDevice(payload, mutation.idempotency_key);
    } catch (error) {
      await this.deferIfTransient(mutation, error);
      return null;
    }
    await this.projectDevice(installationId, response.id);
    return this.deviceId;
  }

  async setMonitoringConsent(granted: boolean): Promise<boolean> {
    if (!this.deviceId) return false;
    const payload = {
      device_id: this.deviceId,
      scope: 'monitoring' as const,
      policy_version: CONSENT_POLICY_VERSION,
      granted
    };
    const mutation = await createPendingMutation('create_consent', payload);
    let response;
    try {
      response = await this.api.createConsent(payload, mutation.idempotency_key);
    } catch (error) {
      await this.deferIfTransient(mutation, error);
      return false;
    }
    await this.projectConsent(response.id, granted);
    return true;
  }

  async start(): Promise<boolean> {
    const next = reduceMonitoring(this.state, { type: 'START_REQUESTED' });
    if (next === this.state || !this.deviceId || !this.consentId) return false;
    this.state = next;
    const payload = {
      device_id: this.deviceId,
      monitoring_consent_id: this.consentId,
      screenshot_consent_id: null,
      capture_policy_version: CAPTURE_POLICY_VERSION,
      started_at: new Date().toISOString()
    };
    const mutation = await createPendingMutation('create_session', payload);
    let response;
    try {
      response = await this.api.createSession(payload, mutation.idempotency_key);
    } catch (error) {
      await this.deferIfTransient(mutation, error);
      return false;
    }
    await this.projectSession(response.id, response.status, NAVIGATION_CAPTURE_POLICY_VERSION);
    if (this.navigation) {
      try {
        const remote = await this.api.getSession(response.id);
        if (
          remote.status !== 'recording' ||
          remote.capturePolicyVersion !== NAVIGATION_CAPTURE_POLICY_VERSION ||
          !this.deviceId
        ) {
          await this.navigation.gate.close();
          this.state = reduceMonitoring(this.state, {
            type: 'SYNC_ERROR',
            code: 'start_reconciliation_failed'
          });
          return false;
        }
        await this.openNavigationCapture(this.deviceId, remote.id);
      } catch {
        await this.navigation.gate.close();
        this.state = reduceMonitoring(this.state, {
          type: 'SYNC_ERROR',
          code: 'start_reconciliation_failed'
        });
        return false;
      }
    }
    return true;
  }

  async pause(): Promise<boolean> {
    return this.transition('PAUSE_REQUESTED', 'pause');
  }
  async resume(): Promise<boolean> {
    const resumed = await this.transition('RESUME_REQUESTED', 'resume');
    if (!resumed || !this.navigation || !this.deviceId || !this.state.sessionId) return resumed;
    try {
      const remote = await this.api.getSession(this.state.sessionId);
      const saved = await this.database.get<{
        id: string;
        session_id?: string;
        capture_policy_version?: string;
      }>('monitoring_sessions', 'current');
      if (
        remote.status !== 'recording' ||
        remote.capturePolicyVersion !== NAVIGATION_CAPTURE_POLICY_VERSION ||
        saved?.session_id !== remote.id
      ) {
        await this.navigation.gate.close();
        this.state = reduceMonitoring(this.state, {
          type: 'SYNC_ERROR',
          code: 'resume_reconciliation_failed'
        });
        return false;
      }
      await this.openNavigationCapture(this.deviceId, remote.id);
      return true;
    } catch {
      await this.navigation.gate.close();
      this.state = reduceMonitoring(this.state, {
        type: 'SYNC_ERROR',
        code: 'resume_reconciliation_failed'
      });
      return false;
    }
  }
  async stop(): Promise<boolean> {
    return this.transition('STOP_REQUESTED', 'complete');
  }

  private async transition(
    event: 'PAUSE_REQUESTED' | 'RESUME_REQUESTED' | 'STOP_REQUESTED',
    action: 'pause' | 'resume' | 'complete'
  ): Promise<boolean> {
    const next = reduceMonitoring(this.state, { type: event });
    if (next === this.state || !this.state.sessionId) return false;
    const sessionId = this.state.sessionId;
    this.state = next;
    if (action === 'pause' && this.lifecycle) {
      const completed = await this.lifecycle.requestPause(sessionId, () =>
        this.dispatchTransition(sessionId, action)
      );
      if (!completed) this.state = reduceMonitoring(this.state, { type: 'OFFLINE_BUFFERING' });
      return completed;
    }
    if (action === 'complete' && this.lifecycle) {
      const completed = await this.lifecycle.requestStop(sessionId, () =>
        this.dispatchTransition(sessionId, action)
      );
      if (!completed) this.state = reduceMonitoring(this.state, { type: 'OFFLINE_BUFFERING' });
      return completed;
    }
    return this.dispatchTransition(sessionId, action);
  }

  private async dispatchTransition(
    sessionId: string,
    action: 'pause' | 'resume' | 'complete'
  ): Promise<boolean> {
    const operation: Record<typeof action, ControlPlaneMutationType> = {
      pause: 'pause_session',
      resume: 'resume_session',
      complete: 'complete_session'
    };
    const mutation = await createPendingMutation(operation[action], { session_id: sessionId });
    let response;
    try {
      response =
        action === 'pause'
          ? await this.api.pauseSession(sessionId, mutation.idempotency_key)
          : action === 'resume'
            ? await this.api.resumeSession(sessionId, mutation.idempotency_key)
            : await this.api.completeSession(sessionId, mutation.idempotency_key);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        try {
          const remote = await this.api.getSession(sessionId);
          const intended =
            action === 'pause' ? 'paused' : action === 'resume' ? 'recording' : 'completed';
          if (remote.status === intended) {
            this.state = reduceMonitoring(this.state, {
              type: 'REMOTE_CONFIRMED',
              status: remote.status,
              sessionId: remote.id
            });
            return true;
          }
          this.state = reduceMonitoring(this.state, {
            type: 'SYNC_ERROR',
            code: 'session_state_conflict'
          });
          return false;
        } catch {
          this.state = reduceMonitoring(this.state, {
            type: 'SYNC_ERROR',
            code: 'reconciliation_failed'
          });
          return false;
        }
      }
      await this.deferIfTransient(mutation, error);
      return false;
    }
    await this.projectSession(response.id, response.status);
    return true;
  }

  private async deferIfTransient(
    mutation: Awaited<ReturnType<typeof createPendingMutation>>,
    error: unknown
  ): Promise<void> {
    const status = error instanceof ApiClientError ? error.status : undefined;
    if (shouldRetryStatus(status)) {
      const retryCount = mutation.retry_count + 1;
      await enqueueMutation(this.database, {
        ...mutation,
        retry_count: retryCount,
        next_retry_at: new Date(Date.now() + nextRetryDelayMs(mutation.retry_count)).toISOString()
      });
      this.state = reduceMonitoring(this.state, { type: 'OFFLINE_BUFFERING' });
      return;
    }
    if (status === 401) this.state = reduceMonitoring(this.state, { type: 'SIGNED_OUT' });
    else
      this.state = reduceMonitoring(this.state, {
        type: 'SYNC_ERROR',
        code: error instanceof ApiClientError ? error.code : 'network_error'
      });
  }

  private async projectDevice(installationId: string, deviceId: string): Promise<void> {
    this.deviceId = deviceId;
    await this.database.put('device_metadata', {
      id: 'current',
      installation_id: installationId,
      device_id: deviceId
    });
  }

  private async projectConsent(consentId: string, granted: boolean): Promise<void> {
    this.consentId = granted ? consentId : null;
    await this.database.put('extension_config', {
      id: 'monitoring-consent',
      consent_id: consentId,
      device_id: this.deviceId,
      policy_version: CONSENT_POLICY_VERSION,
      granted,
      verified_at: new Date().toISOString()
    });
    this.state = reduceMonitoring(this.state, { type: 'READY', consentActive: granted });
  }

  private async openNavigationCapture(deviceId: string, sessionId: string): Promise<void> {
    if (!this.navigation) return;
    const context = this.navigation.gate.open({
      deviceId,
      sessionId,
      capturePolicyVersion: NAVIGATION_CAPTURE_POLICY_VERSION
    });
    try {
      await this.navigation.repository.openSession(context);
      await this.navigation.schedulePendingDelivery();
    } catch (error) {
      await this.navigation.gate.close();
      throw error;
    }
  }

  private async projectSession(
    sessionId: string,
    status: RemoteSessionStatus,
    capturePolicyVersion?: string
  ): Promise<void> {
    this.state = reduceMonitoring(this.state, {
      type: 'REMOTE_CONFIRMED',
      status,
      sessionId
    });
    const existing = await this.database.get<{
      id: string;
      session_id?: string;
      capture_policy_version?: string;
    }>('monitoring_sessions', 'current');
    await this.database.put('monitoring_sessions', {
      id: 'current',
      session_id: sessionId,
      status,
      device_id: this.deviceId,
      capture_policy_version:
        capturePolicyVersion ??
        (existing?.session_id === sessionId ? existing.capture_policy_version : undefined)
    });
  }
}

function isRemoteSessionStatus(value: unknown): value is RemoteSessionStatus {
  return (
    value === 'recording' || value === 'paused' || value === 'completed' || value === 'cancelled'
  );
}
