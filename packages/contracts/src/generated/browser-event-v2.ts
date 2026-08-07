/* This file is generated from schemas/events/browser-event.v2.schema.json and browser-event-batch.v2.schema.json. DO NOT EDIT. */

export type BrowserEventV2Kind = 'navigation';

export interface BrowserEventV2 {
  client_event_id: string;
  sequence_number: number;
  event_kind: 'navigation';
  occurred_at: string;
  page_domain: string;
  transition_type:
    | 'link'
    | 'typed'
    | 'auto_bookmark'
    | 'generated'
    | 'start_page'
    | 'form_submit'
    | 'reload'
    | 'keyword'
    | 'keyword_generated';
  capture_policy_version: string;
}

export interface BrowserEventBatchV2 {
  device_id: string;
  session_id: string;
  events: BrowserEventV2[];
}
