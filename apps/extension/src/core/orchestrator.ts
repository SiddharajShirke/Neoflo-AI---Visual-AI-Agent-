import type { ApiClient } from '../api/client.js';
import { ApiClientError } from '../api/client.js';
import type { ControlPlaneDatabase } from '../persistence/database.js';
import {
  createPendingMutation,
  enqueueMutation,
  type ControlPlaneMutationType
} from '../queue/mutations.js';
import { nextRetryDelayMs, shouldRetryStatus } from '../queue/retry.js';
import { initialMonitoringState, reduceMonitoring, type MonitoringState } from './state-machine.js';

const CONSENT_POLICY_VERSION = 'm3-monitoring-v1';
const CAPTURE_POLICY_VERSION = 'm3-capture-v1';

export class ControlPlaneOrchestrator {
  private state: MonitoringState = initialMonitoringState;
  private deviceId: string | null = null;
  private consentId: string | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly database: ControlPlaneDatabase
  ) {}

  snapshot(): MonitoringState {
    return { ...this.state };
  }

  async initialize(authenticated: boolean): Promise<MonitoringState> {
    if (!authenticated) {
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
    }>('monitoring_sessions', 'current');
    if (session?.session_id && (session.status === 'recording' || session.status === 'paused')) {
      this.state = reduceMonitoring(this.state, {
        type: 'REMOTE_CONFIRMED',
        status: session.status,
        sessionId: session.session_id
      });
      try {
        const remote = await this.api.getSession(session.session_id);
        this.state = reduceMonitoring(this.state, {
          type: 'REMOTE_CONFIRMED',
          status: remote.status,
          sessionId: remote.id
        });
        await this.database.put('monitoring_sessions', {
          id: 'current',
          session_id: remote.id,
          status: remote.status,
          device_id: this.deviceId
        });
      } catch {
        this.state = reduceMonitoring(this.state, {
          type: 'SYNC_ERROR',
          code: 'restart_reconciliation_failed'
        });
      }
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
    this.deviceId = response.id;
    await this.database.put('device_metadata', {
      id: 'current',
      installation_id: installationId,
      device_id: response.id
    });
    return response.id;
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
    this.consentId = granted ? response.id : null;
    await this.database.put('extension_config', {
      id: 'monitoring-consent',
      consent_id: response.id,
      device_id: this.deviceId,
      policy_version: CONSENT_POLICY_VERSION,
      granted,
      verified_at: new Date().toISOString()
    });
    this.state = reduceMonitoring(this.state, { type: 'READY', consentActive: granted });
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
    this.state = reduceMonitoring(this.state, {
      type: 'REMOTE_CONFIRMED',
      status: response.status,
      sessionId: response.id
    });
    await this.database.put('monitoring_sessions', {
      id: 'current',
      session_id: response.id,
      status: response.status,
      device_id: this.deviceId
    });
    return true;
  }

  async pause(): Promise<boolean> {
    return this.transition('PAUSE_REQUESTED', 'pause');
  }
  async resume(): Promise<boolean> {
    return this.transition('RESUME_REQUESTED', 'resume');
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
    this.state = reduceMonitoring(this.state, {
      type: 'REMOTE_CONFIRMED',
      status: response.status,
      sessionId: response.id
    });
    await this.database.put('monitoring_sessions', {
      id: 'current',
      session_id: response.id,
      status: response.status,
      device_id: this.deviceId
    });
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
}
