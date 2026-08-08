import { isBrowserEventV2, type BrowserEventV2 } from '@visual-ai/contracts';
import type { CaptureContext } from './capture-gate.js';

export interface NavigationEventRecord extends BrowserEventV2 {
  delivery_state: 'unbatched' | 'batched';
  batch_id?: string;
  created_at: string;
}

export interface NavigationCoordinationRecord {
  id: 'navigation_coordination';
  buffer_session_id: string;
  gate_generation: number;
  gate_open: boolean;
  next_sequence_number: number;
  event_count: number;
  event_bytes: number;
  oldest_pending_at: string | null;
  sync_status: 'healthy' | 'offline_buffering' | 'sync_error';
  lifecycle_intent: NavigationLifecycleIntent | null;
}

export type NavigationLifecycleIntent = 'pause' | 'complete';

export type NavigationBatchState =
  | 'pending'
  | 'delivering'
  | 'reconciling'
  | 'failed_permanent'
  | 'blocked_auth';

export interface NavigationBatchRecord {
  batch_id: string;
  idempotency_key: string;
  device_id: string;
  session_id: string;
  event_ids: readonly string[];
  canonical_request_hash: string;
  retry_count: number;
  next_retry_at: string;
  delivery_state: NavigationBatchState;
  created_at: string;
  updated_at: string;
}

const NAVIGATION_COORDINATION_ID = 'navigation_coordination';
export const MAX_PENDING_EVENTS = 1_000;
export const MAX_PENDING_EVENT_BYTES = 1_048_576;
export const MAX_BATCH_EVENTS = 20;

interface NavigationRepositoryLimits {
  maxPendingEvents?: number;
  maxPendingEventBytes?: number;
}

const contextKeys = new Set(['generation', 'deviceId', 'sessionId', 'capturePolicyVersion']);

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

function assertCaptureContext(context: CaptureContext): void {
  if (
    Object.keys(context).length !== contextKeys.size ||
    !Object.keys(context).every((key) => contextKeys.has(key)) ||
    !Number.isInteger(context.generation) ||
    context.generation < 1 ||
    typeof context.deviceId !== 'string' ||
    typeof context.sessionId !== 'string' ||
    context.capturePolicyVersion !== 'm4-navigation-v1'
  ) {
    throw new Error('capture context has invalid fields');
  }
}

function assertNavigationEvent(event: BrowserEventV2): void {
  if (!isBrowserEventV2(event)) throw new Error('navigation event has invalid fields');
}

function coordinationRecord(context: CaptureContext): NavigationCoordinationRecord {
  return {
    id: NAVIGATION_COORDINATION_ID,
    buffer_session_id: context.sessionId,
    gate_generation: context.generation,
    gate_open: true,
    next_sequence_number: 1,
    event_count: 0,
    event_bytes: 0,
    oldest_pending_at: null,
    sync_status: 'healthy',
    lifecycle_intent: null
  };
}

function navigationRecordBytes(record: NavigationEventRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

export class NavigationRepository {
  private readonly maxPendingEvents: number;
  private readonly maxPendingEventBytes: number;

  constructor(
    private readonly database: IDBDatabase,
    private readonly now: () => Date = () => new Date(),
    limits: NavigationRepositoryLimits = {}
  ) {
    this.maxPendingEvents = limits.maxPendingEvents ?? MAX_PENDING_EVENTS;
    this.maxPendingEventBytes = limits.maxPendingEventBytes ?? MAX_PENDING_EVENT_BYTES;
  }

  private transaction(
    stores:
      | 'sync_metadata'
      | 'navigation_event_buffer'
      | 'navigation_batches'
      | readonly ('sync_metadata' | 'navigation_event_buffer' | 'navigation_batches')[],
    mode: IDBTransactionMode
  ): IDBTransaction {
    return this.database.transaction(stores, mode);
  }

  async openSession(context: CaptureContext): Promise<void> {
    assertCaptureContext(context);
    const transaction = this.transaction('sync_metadata', 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore('sync_metadata');
    const existing = (await requestResult(store.get(NAVIGATION_COORDINATION_ID))) as
      | NavigationCoordinationRecord
      | undefined;
    if (
      existing !== undefined &&
      existing.buffer_session_id !== context.sessionId &&
      existing.event_count > 0
    ) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error('another navigation session still has pending events');
    }
    if (existing?.buffer_session_id === context.sessionId && existing.lifecycle_intent !== null) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error('navigation lifecycle drain unresolved');
    }
    store.put(
      existing?.buffer_session_id === context.sessionId
        ? { ...existing, gate_generation: context.generation, gate_open: true }
        : coordinationRecord(context)
    );
    await completed;
  }

  async append(
    event: BrowserEventV2,
    context: CaptureContext
  ): Promise<'appended' | 'closed' | 'capacity_exceeded'> {
    assertNavigationEvent(event);
    assertCaptureContext(context);
    const { sequence_number: allocatedByRepository, ...draft } = event;
    void allocatedByRepository;
    return this.appendDraft(draft, context);
  }

  async appendDraft(
    draft: Omit<BrowserEventV2, 'sequence_number'>,
    context: CaptureContext
  ): Promise<'appended' | 'closed' | 'capacity_exceeded'> {
    assertCaptureContext(context);
    const candidateForValidation = { ...draft, sequence_number: 1 };
    assertNavigationEvent(candidateForValidation);

    const transaction = this.transaction(['sync_metadata', 'navigation_event_buffer'], 'readwrite');
    const completed = transactionComplete(transaction);
    const coordinationStore = transaction.objectStore('sync_metadata');
    const coordination = (await requestResult(
      coordinationStore.get(NAVIGATION_COORDINATION_ID)
    )) as NavigationCoordinationRecord | undefined;
    if (
      coordination === undefined ||
      !coordination.gate_open ||
      coordination.gate_generation !== context.generation ||
      coordination.buffer_session_id !== context.sessionId
    ) {
      await completed;
      return 'closed';
    }

    const createdAt = this.now().toISOString();
    const record: NavigationEventRecord = {
      ...draft,
      sequence_number: coordination.next_sequence_number,
      delivery_state: 'unbatched',
      created_at: createdAt
    };
    const candidateBytes = navigationRecordBytes(record);
    if (
      coordination.event_count + 1 > this.maxPendingEvents ||
      coordination.event_bytes + candidateBytes > this.maxPendingEventBytes
    ) {
      await completed;
      return 'capacity_exceeded';
    }
    transaction.objectStore('navigation_event_buffer').add(record);
    coordinationStore.put({
      ...coordination,
      next_sequence_number: coordination.next_sequence_number + 1,
      event_count: coordination.event_count + 1,
      event_bytes: coordination.event_bytes + candidateBytes,
      oldest_pending_at: coordination.oldest_pending_at ?? createdAt
    } satisfies NavigationCoordinationRecord);
    await completed;
    return 'appended';
  }

  async getCoordinationState(): Promise<NavigationCoordinationRecord | null> {
    const transaction = this.transaction('sync_metadata', 'readonly');
    return (
      ((await requestResult(
        transaction.objectStore('sync_metadata').get(NAVIGATION_COORDINATION_ID)
      )) as NavigationCoordinationRecord | undefined) ?? null
    );
  }

  async closeWithSyncError(context: CaptureContext): Promise<void> {
    assertCaptureContext(context);
    const transaction = this.transaction('sync_metadata', 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore('sync_metadata');
    const coordination = (await requestResult(store.get(NAVIGATION_COORDINATION_ID))) as
      | NavigationCoordinationRecord
      | undefined;
    if (
      coordination?.buffer_session_id === context.sessionId &&
      coordination.gate_generation === context.generation
    ) {
      store.put({
        ...coordination,
        gate_open: false,
        sync_status: 'sync_error'
      } satisfies NavigationCoordinationRecord);
    }
    await completed;
  }

  async closeForLifecycle(sessionId: string, intent: NavigationLifecycleIntent): Promise<void> {
    const transaction = this.transaction('sync_metadata', 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore('sync_metadata');
    const coordination = (await requestResult(store.get(NAVIGATION_COORDINATION_ID))) as
      | NavigationCoordinationRecord
      | undefined;
    if (coordination === undefined || coordination.buffer_session_id !== sessionId) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error('navigation session is not active');
    }
    if (coordination.lifecycle_intent !== null && coordination.lifecycle_intent !== intent) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error('conflicting navigation lifecycle intent');
    }
    store.put({
      ...coordination,
      gate_open: false,
      gate_generation: coordination.gate_generation + 1,
      lifecycle_intent: intent
    } satisfies NavigationCoordinationRecord);
    await completed;
  }

  async getLifecycleIntent(sessionId: string): Promise<NavigationLifecycleIntent | null> {
    const coordination = await this.getCoordinationState();
    return coordination?.buffer_session_id === sessionId ? coordination.lifecycle_intent : null;
  }

  async clearLifecycleIntent(sessionId: string, intent: NavigationLifecycleIntent): Promise<void> {
    const transaction = this.transaction('sync_metadata', 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore('sync_metadata');
    const coordination = (await requestResult(store.get(NAVIGATION_COORDINATION_ID))) as
      | NavigationCoordinationRecord
      | undefined;
    if (coordination?.buffer_session_id === sessionId && coordination.lifecycle_intent === intent) {
      store.put({ ...coordination, lifecycle_intent: null } satisfies NavigationCoordinationRecord);
    }
    await completed;
  }

  async hasPendingForSession(sessionId: string): Promise<boolean> {
    const coordination = await this.getCoordinationState();
    return coordination?.buffer_session_id === sessionId && coordination.event_count > 0;
  }

  async formNextBatch(
    context: CaptureContext,
    maximumEvents: number,
    expectedEventIds: readonly string[],
    canonicalRequestHash: string
  ): Promise<NavigationBatchRecord | null> {
    assertCaptureContext(context);
    if (!Number.isInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > MAX_BATCH_EVENTS) {
      return null;
    }
    if (!/^[a-f0-9]{64}$/.test(canonicalRequestHash)) {
      throw new Error('canonical request hash is required');
    }
    const transaction = this.transaction(
      ['sync_metadata', 'navigation_event_buffer', 'navigation_batches'],
      'readwrite'
    );
    const completed = transactionComplete(transaction);
    const coordination = (await requestResult(
      transaction.objectStore('sync_metadata').get(NAVIGATION_COORDINATION_ID)
    )) as NavigationCoordinationRecord | undefined;
    if (
      coordination === undefined ||
      coordination.buffer_session_id !== context.sessionId ||
      coordination.gate_generation !== context.generation
    ) {
      await completed;
      return null;
    }

    const eventStore = transaction.objectStore('navigation_event_buffer');
    const candidates = ((await requestResult(eventStore.getAll())) as NavigationEventRecord[])
      .filter((record) => record.delivery_state === 'unbatched')
      .sort((left, right) => left.sequence_number - right.sequence_number)
      .slice(0, maximumEvents);
    if (
      candidates.length === 0 ||
      candidates.length !== expectedEventIds.length ||
      candidates.some((candidate, index) => candidate.client_event_id !== expectedEventIds[index])
    ) {
      await completed;
      return null;
    }

    const timestamp = this.now().toISOString();
    const batch: NavigationBatchRecord = {
      batch_id: crypto.randomUUID(),
      idempotency_key: crypto.randomUUID(),
      device_id: context.deviceId,
      session_id: context.sessionId,
      event_ids: candidates.map((record) => record.client_event_id),
      canonical_request_hash: canonicalRequestHash,
      retry_count: 0,
      next_retry_at: timestamp,
      delivery_state: 'pending',
      created_at: timestamp,
      updated_at: timestamp
    };
    transaction.objectStore('navigation_batches').add(batch);
    for (const record of candidates) {
      eventStore.put({ ...record, delivery_state: 'batched', batch_id: batch.batch_id });
    }
    await completed;
    return Object.freeze({ ...batch, event_ids: Object.freeze([...batch.event_ids]) });
  }

  async listNextUnbatched(maximumEvents: number): Promise<readonly NavigationEventRecord[]> {
    return (await this.listUnbatched()).slice(0, maximumEvents);
  }

  async getBatch(batchId: string): Promise<NavigationBatchRecord | null> {
    const transaction = this.transaction('navigation_batches', 'readonly');
    const batch = (await requestResult(
      transaction.objectStore('navigation_batches').get(batchId)
    )) as NavigationBatchRecord | undefined;
    return batch === undefined
      ? null
      : Object.freeze({ ...batch, event_ids: Object.freeze([...batch.event_ids]) });
  }

  async listDueBatches(now = this.now()): Promise<readonly NavigationBatchRecord[]> {
    const transaction = this.transaction('navigation_batches', 'readonly');
    const records = (await requestResult(
      transaction.objectStore('navigation_batches').getAll()
    )) as NavigationBatchRecord[];
    return records
      .filter(
        (record) =>
          record.delivery_state === 'pending' &&
          record.retry_count < 7 &&
          Date.parse(record.next_retry_at) <= now.getTime()
      )
      .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
      .map((record) =>
        Object.freeze({ ...record, event_ids: Object.freeze([...record.event_ids]) })
      );
  }

  /** Reconciliation is a durable no-send hold until fresh server authority resolves it. */
  async listReconcilingBatches(): Promise<readonly NavigationBatchRecord[]> {
    const transaction = this.transaction('navigation_batches', 'readonly');
    const records = (await requestResult(
      transaction.objectStore('navigation_batches').getAll()
    )) as NavigationBatchRecord[];
    return records
      .filter((record) => record.delivery_state === 'reconciling')
      .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
      .map((record) =>
        Object.freeze({ ...record, event_ids: Object.freeze([...record.event_ids]) })
      );
  }

  /** Atomically turns one due immutable batch into an HTTP attempt. */
  async claimBatch(batchId: string, now = this.now()): Promise<NavigationBatchRecord | null> {
    const transaction = this.transaction('navigation_batches', 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore('navigation_batches');
    const batch = (await requestResult(store.get(batchId))) as NavigationBatchRecord | undefined;
    if (
      batch === undefined ||
      batch.delivery_state !== 'pending' ||
      batch.retry_count >= 7 ||
      Date.parse(batch.next_retry_at) > now.getTime()
    ) {
      await completed;
      return null;
    }
    const claimed: NavigationBatchRecord = {
      ...batch,
      retry_count: batch.retry_count + 1,
      delivery_state: 'delivering',
      updated_at: now.toISOString()
    };
    store.put(claimed);
    await completed;
    return Object.freeze({ ...claimed, event_ids: Object.freeze([...claimed.event_ids]) });
  }

  async setBatchDeliveryState(
    batchId: string,
    state: NavigationBatchState,
    now = this.now(),
    nextRetryAt?: Date,
    retryCount?: number
  ): Promise<void> {
    const transaction = this.transaction('navigation_batches', 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore('navigation_batches');
    const batch = (await requestResult(store.get(batchId))) as NavigationBatchRecord | undefined;
    if (batch !== undefined) {
      store.put({
        ...batch,
        delivery_state: state,
        retry_count: retryCount ?? batch.retry_count,
        next_retry_at: nextRetryAt?.toISOString() ?? batch.next_retry_at,
        updated_at: now.toISOString()
      } satisfies NavigationBatchRecord);
    }
    await completed;
  }

  async recoverStaleDelivering(now = this.now()): Promise<void> {
    const transaction = this.transaction('navigation_batches', 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore('navigation_batches');
    const batches = (await requestResult(store.getAll())) as NavigationBatchRecord[];
    for (const batch of batches) {
      if (batch.delivery_state === 'delivering') {
        store.put({
          ...batch,
          delivery_state: 'pending',
          updated_at: now.toISOString()
        } satisfies NavigationBatchRecord);
      }
    }
    await completed;
  }

  /** Deletes only a fully acknowledged batch and its exact member records in one transaction. */
  async acknowledgeBatch(
    batchId: string,
    acceptedCount: number,
    duplicateCount: number
  ): Promise<boolean> {
    const transaction = this.transaction(
      ['sync_metadata', 'navigation_event_buffer', 'navigation_batches'],
      'readwrite'
    );
    const completed = transactionComplete(transaction);
    const batchStore = transaction.objectStore('navigation_batches');
    const batch = (await requestResult(batchStore.get(batchId))) as
      | NavigationBatchRecord
      | undefined;
    if (
      batch === undefined ||
      !Number.isInteger(acceptedCount) ||
      !Number.isInteger(duplicateCount) ||
      acceptedCount < 0 ||
      duplicateCount < 0 ||
      acceptedCount + duplicateCount !== batch.event_ids.length
    ) {
      if (batch !== undefined) {
        batchStore.put({
          ...batch,
          delivery_state: 'failed_permanent'
        } satisfies NavigationBatchRecord);
      }
      await completed;
      return false;
    }
    const eventStore = transaction.objectStore('navigation_event_buffer');
    const records = (await requestResult(eventStore.getAll())) as NavigationEventRecord[];
    const memberRecords = batch.event_ids.map((eventId) => {
      const record = records.find(
        (candidate) => candidate.client_event_id === eventId && candidate.batch_id === batchId
      );
      return record;
    });
    if (memberRecords.some((record) => record === undefined)) {
      batchStore.put({
        ...batch,
        delivery_state: 'failed_permanent'
      } satisfies NavigationBatchRecord);
      await completed;
      return false;
    }
    const exactMembers = memberRecords as NavigationEventRecord[];
    for (const record of exactMembers) eventStore.delete(record.client_event_id);
    batchStore.delete(batchId);
    const coordinationStore = transaction.objectStore('sync_metadata');
    const coordination = (await requestResult(
      coordinationStore.get(NAVIGATION_COORDINATION_ID)
    )) as NavigationCoordinationRecord | undefined;
    if (coordination !== undefined) {
      const retained = records.filter(
        (record) => !batch.event_ids.includes(record.client_event_id)
      );
      coordinationStore.put({
        ...coordination,
        event_count: retained.length,
        event_bytes: retained.reduce((total, record) => total + navigationRecordBytes(record), 0),
        oldest_pending_at:
          retained
            .map((record) => record.created_at)
            .sort((left, right) => left.localeCompare(right))[0] ?? null,
        sync_status: 'healthy'
      } satisfies NavigationCoordinationRecord);
    }
    await completed;
    return true;
  }

  async listEventsForBatch(batchId: string): Promise<readonly NavigationEventRecord[]> {
    const transaction = this.transaction('navigation_event_buffer', 'readonly');
    const records = (await requestResult(
      transaction.objectStore('navigation_event_buffer').getAll()
    )) as NavigationEventRecord[];
    return records
      .filter((record) => record.delivery_state === 'batched' && record.batch_id === batchId)
      .sort((left, right) => left.sequence_number - right.sequence_number);
  }

  async listUnbatched(): Promise<readonly NavigationEventRecord[]> {
    const transaction = this.transaction('navigation_event_buffer', 'readonly');
    const records = (await requestResult(
      transaction.objectStore('navigation_event_buffer').getAll()
    )) as NavigationEventRecord[];
    return records
      .filter((record) => record.delivery_state === 'unbatched')
      .sort((left, right) => left.sequence_number - right.sequence_number);
  }

  async purgeSession(sessionId: string): Promise<void> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('session id is required');
    }
    const transaction = this.transaction(
      ['navigation_event_buffer', 'navigation_batches', 'sync_metadata'],
      'readwrite'
    );
    const completed = transactionComplete(transaction);
    const coordinationStore = transaction.objectStore('sync_metadata');
    const coordination = (await requestResult(
      coordinationStore.get(NAVIGATION_COORDINATION_ID)
    )) as NavigationCoordinationRecord | undefined;
    if (coordination?.buffer_session_id !== sessionId) {
      await completed;
      return;
    }
    transaction.objectStore('navigation_event_buffer').clear();
    transaction.objectStore('navigation_batches').clear();
    coordinationStore.delete(NAVIGATION_COORDINATION_ID);
    await completed;
  }
}
