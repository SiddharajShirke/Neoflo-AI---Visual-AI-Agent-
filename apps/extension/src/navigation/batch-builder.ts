import type { CaptureContext } from './capture-gate.js';
import { buildCanonicalBatchRequest, sha256CanonicalBatch } from './canonical-request.js';
import {
  MAX_BATCH_EVENTS,
  type NavigationBatchRecord,
  type NavigationRepository
} from './navigation-repository.js';
import type { NavigationMetrics } from './metrics.js';

export { MAX_BATCH_EVENTS } from './navigation-repository.js';

export async function formNextBatch(
  repository: NavigationRepository,
  context: CaptureContext,
  metrics?: NavigationMetrics,
  performanceNow: () => number = () => performance.now()
): Promise<NavigationBatchRecord | null> {
  const started = performanceNow();
  const events = await repository.listNextUnbatched(MAX_BATCH_EVENTS);
  if (events.length === 0) {
    metrics?.recordDuration('batch_construction_ms', performanceNow() - started);
    return null;
  }
  const eventIds = events.map((event) => event.client_event_id);
  const hashInput: NavigationBatchRecord = {
    batch_id: '',
    idempotency_key: '',
    device_id: context.deviceId,
    session_id: context.sessionId,
    event_ids: eventIds,
    canonical_request_hash: '0'.repeat(64),
    retry_count: 0,
    next_retry_at: '',
    delivery_state: 'pending',
    created_at: '',
    updated_at: ''
  };
  const canonicalRequestHash = await sha256CanonicalBatch(
    buildCanonicalBatchRequest(hashInput, events)
  );
  const batch = await repository.formNextBatch(
    context,
    MAX_BATCH_EVENTS,
    eventIds,
    canonicalRequestHash
  );
  metrics?.recordDuration('batch_construction_ms', performanceNow() - started);
  if (batch !== null) metrics?.recordBatchSize(batch.event_ids.length);
  return batch;
}
