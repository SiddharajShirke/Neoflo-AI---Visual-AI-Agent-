/* This file is generated from schemas/events/browser-event.v1.schema.json and browser-event-batch.v1.schema.json. DO NOT EDIT. */

export type BrowserEventKind = 'navigation' | 'meaningful_action' | 'visibility_change';

export interface BrowserEvent {
  client_event_id: string;
  sequence_number: number;
  event_kind: 'navigation' | 'meaningful_action' | 'visibility_change';
  occurred_at: string;
  page_origin?: string | null;
  page_path_hash?: string | null;
  page_title_redacted?: string | null;
  accessibility_context_redacted?: string | null;
  context_sha256?: string | null;
  capture_policy_version: string;
}

export interface BrowserEventBatch {
  device_id: string;
  session_id: string;
  events: BrowserEvent[];
}

export interface EventIngestionResponse {
  accepted_count: number;
  duplicate_count: number;
}
