import type { ControlPlaneDatabase } from '../persistence/database.js';

export type ControlPlaneMutationType =
  | 'register_device'
  | 'create_consent'
  | 'create_session'
  | 'pause_session'
  | 'resume_session'
  | 'complete_session'
  | 'cancel_session';

export type PendingMutationState =
  | 'pending'
  | 'delivering'
  | 'blocked_auth'
  | 'failed_permanent'
  | 'succeeded';

/** Deliberately minimal: credentials and browser content are never queueable. */
export interface PendingMutation extends Record<string, unknown> {
  local_operation_id: string;
  idempotency_key: string;
  operation_type: ControlPlaneMutationType;
  payload: Record<string, unknown>;
  payload_sha256: string;
  created_at: string;
  retry_count: number;
  next_retry_at: string;
  state: PendingMutationState;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createPendingMutation(
  operationType: ControlPlaneMutationType,
  payload: Record<string, unknown>,
  now = new Date(),
  uuid: () => string = () => crypto.randomUUID(),
  hash: (value: string) => Promise<string> = sha256
): Promise<PendingMutation> {
  const localOperationId = uuid();
  const idempotencyKey = localOperationId;
  const timestamp = now.toISOString();
  return {
    local_operation_id: localOperationId,
    idempotency_key: idempotencyKey,
    operation_type: operationType,
    payload,
    payload_sha256: await hash(canonicalize({ operation_type: operationType, payload })),
    created_at: timestamp,
    retry_count: 0,
    next_retry_at: timestamp,
    state: 'pending'
  };
}

export async function enqueueMutation(
  database: ControlPlaneDatabase,
  mutation: PendingMutation
): Promise<boolean> {
  const existing = await database.get<PendingMutation>(
    'pending_mutations',
    mutation.local_operation_id
  );
  if (existing) return false;
  await database.put('pending_mutations', mutation);
  return true;
}

export function isDeliverable(mutation: PendingMutation, now = new Date()): boolean {
  return (
    mutation.state === 'pending' &&
    mutation.retry_count < 7 &&
    Date.parse(mutation.next_retry_at) <= now.getTime()
  );
}
