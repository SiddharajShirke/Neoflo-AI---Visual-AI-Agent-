import { ApiClientError, type ApiClient } from '../api/client.js';
import type { ControlPlaneDatabase } from '../persistence/database.js';
import { isDeliverable, type ControlPlaneMutationType, type PendingMutation } from './mutations.js';
import { MAX_ATTEMPTS, nextRetryDelayMs, retryAfterDelayMs, shouldRetryStatus } from './retry.js';

type TransitionStatus = 'recording' | 'paused' | 'completed';

export interface DeliveryHooks {
  onAuthRequired?: () => void;
  onDelivered?: (mutation: PendingMutation, response: unknown) => Promise<void>;
  onReconciled?: (sessionId: string, status: TransitionStatus) => void;
  onSyncError?: (code: string) => void;
  random?: () => number;
}

function sessionId(payload: Record<string, unknown>): string {
  if (typeof payload.session_id !== 'string')
    throw new ApiClientError(400, 'invalid_queue_payload');
  return payload.session_id;
}

function desiredStatus(type: ControlPlaneMutationType): TransitionStatus | null {
  if (type === 'pause_session') return 'paused';
  if (type === 'resume_session') return 'recording';
  if (type === 'complete_session') return 'completed';
  return null;
}

export class MutationDeliveryEngine {
  private delivering = false;

  constructor(
    private readonly database: ControlPlaneDatabase,
    private readonly api: ApiClient,
    private readonly hooks: DeliveryHooks = {}
  ) {}

  async deliverDue(now = new Date()): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    try {
      const mutations = await this.database.getAll<PendingMutation>('pending_mutations');
      for (const mutation of mutations.filter((item) => isDeliverable(item, now)))
        await this.deliverOne(mutation, now);
    } finally {
      this.delivering = false;
    }
  }

  private async deliverOne(mutation: PendingMutation, now: Date): Promise<void> {
    await this.database.put('pending_mutations', { ...mutation, state: 'delivering' });
    try {
      const response = await this.dispatch(mutation);
      await this.hooks.onDelivered?.(mutation, response);
      await this.confirm(mutation);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        await this.database.put('pending_mutations', { ...mutation, state: 'blocked_auth' });
        this.hooks.onAuthRequired?.();
        return;
      }
      if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        (await this.reconcileConflict(mutation))
      )
        return;
      const status = error instanceof ApiClientError ? error.status : undefined;
      if (shouldRetryStatus(status) && mutation.retry_count + 1 < MAX_ATTEMPTS) {
        const retryAfter =
          error instanceof ApiClientError ? retryAfterDelayMs(error.retryAfter) : null;
        const delay =
          retryAfter ??
          nextRetryDelayMs(mutation.retry_count, this.hooks.random?.() ?? Math.random());
        await this.database.put('pending_mutations', {
          ...mutation,
          retry_count: mutation.retry_count + 1,
          next_retry_at: new Date(now.getTime() + delay).toISOString(),
          state: 'pending'
        });
        return;
      }
      await this.database.put('pending_mutations', { ...mutation, state: 'failed_permanent' });
      this.hooks.onSyncError?.(error instanceof ApiClientError ? error.code : 'network_error');
    }
  }

  private async dispatch(mutation: PendingMutation): Promise<unknown> {
    const payload = mutation.payload;
    switch (mutation.operation_type) {
      case 'register_device':
        return this.api.registerDevice(payload as never, mutation.idempotency_key);
      case 'create_consent':
        return this.api.createConsent(payload as never, mutation.idempotency_key);
      case 'create_session':
        return this.api.createSession(payload as never, mutation.idempotency_key);
      case 'pause_session':
        return this.api.pauseSession(sessionId(payload), mutation.idempotency_key);
      case 'resume_session':
        return this.api.resumeSession(sessionId(payload), mutation.idempotency_key);
      case 'complete_session':
        return this.api.completeSession(sessionId(payload), mutation.idempotency_key);
      case 'cancel_session':
        return this.api.cancelSession(sessionId(payload), mutation.idempotency_key);
    }
  }

  private async confirm(mutation: PendingMutation): Promise<void> {
    await this.database.put('idempotency_records', {
      id: mutation.local_operation_id,
      operation_type: mutation.operation_type,
      payload_sha256: mutation.payload_sha256,
      completed_at: new Date().toISOString()
    });
    await this.database.delete('pending_mutations', mutation.local_operation_id);
  }

  private async reconcileConflict(mutation: PendingMutation): Promise<boolean> {
    const intended = desiredStatus(mutation.operation_type);
    if (!intended) return false;
    try {
      const id = sessionId(mutation.payload);
      const remote = await this.api.getSession(id);
      if (remote.status === intended) {
        await this.confirm(mutation);
        this.hooks.onReconciled?.(id, intended);
        return true;
      }
      await this.database.put('pending_mutations', { ...mutation, state: 'failed_permanent' });
      this.hooks.onSyncError?.('session_state_conflict');
      return true;
    } catch (error) {
      await this.database.put('pending_mutations', { ...mutation, state: 'failed_permanent' });
      this.hooks.onSyncError?.(
        error instanceof ApiClientError ? error.code : 'reconciliation_failed'
      );
      return true;
    }
  }
}
