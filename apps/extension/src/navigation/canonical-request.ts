import {
  isBrowserEventBatchV2,
  type BrowserEventBatchV2,
  type BrowserEventV2
} from '@visual-ai/contracts';
import type { NavigationBatchRecord, NavigationEventRecord } from './navigation-repository.js';

function transportEvent(record: NavigationEventRecord): BrowserEventV2 {
  return {
    client_event_id: record.client_event_id,
    sequence_number: record.sequence_number,
    event_kind: record.event_kind,
    occurred_at: record.occurred_at,
    page_domain: record.page_domain,
    transition_type: record.transition_type,
    capture_policy_version: record.capture_policy_version
  };
}

export function buildCanonicalBatchRequest(
  batch: NavigationBatchRecord,
  events: readonly NavigationEventRecord[]
): BrowserEventBatchV2 {
  const byId = new Map(events.map((event) => [event.client_event_id, event]));
  if (byId.size !== events.length || batch.event_ids.length !== events.length) {
    throw new Error('batch event membership mismatch');
  }
  const orderedEvents = batch.event_ids.map((eventId) => {
    const event = byId.get(eventId);
    if (event === undefined) throw new Error('batch event membership mismatch');
    return transportEvent(event);
  });
  const request: BrowserEventBatchV2 = {
    device_id: batch.device_id,
    session_id: batch.session_id,
    events: orderedEvents
  };
  if (!isBrowserEventBatchV2(request)) throw new Error('invalid canonical navigation batch');
  return request;
}

function stableSerialize(request: BrowserEventBatchV2): string {
  return JSON.stringify({
    device_id: request.device_id,
    session_id: request.session_id,
    events: request.events.map((event) => ({
      client_event_id: event.client_event_id,
      sequence_number: event.sequence_number,
      event_kind: event.event_kind,
      occurred_at: event.occurred_at,
      page_domain: event.page_domain,
      transition_type: event.transition_type,
      capture_policy_version: event.capture_policy_version
    }))
  });
}

export async function sha256CanonicalBatch(request: BrowserEventBatchV2): Promise<string> {
  if (!isBrowserEventBatchV2(request)) throw new Error('invalid canonical navigation batch');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(stableSerialize(request))
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
