import validFixture from '../../../schemas/events/fixtures/browser-event-batch.v2.valid.json';
import invalidFixture from '../../../schemas/events/fixtures/browser-event-batch.v2.invalid-prohibited-field.json';
import { describe, expect, it } from 'vitest';
import { isBrowserEventBatchV2 } from '../src/index.js';

const validEvent = validFixture.events[0];

function withEventField(field: string, value: unknown = 'synthetic') {
  return {
    ...validFixture,
    events: [{ ...validEvent, [field]: value }]
  };
}

describe('browser event v2 contract', () => {
  it('accepts only the navigation-only v2 fixture', () => {
    expect(isBrowserEventBatchV2(validFixture)).toBe(true);
    expect(validEvent).toEqual({
      client_event_id: '11111111-1111-4111-8111-111111111111',
      sequence_number: 1,
      event_kind: 'navigation',
      occurred_at: '2026-08-08T10:00:00Z',
      page_domain: 'example.test',
      transition_type: 'link',
      capture_policy_version: 'm4-navigation-v1'
    });
  });

  it('rejects the prohibited-field fixture', () => {
    expect(isBrowserEventBatchV2(invalidFixture)).toBe(false);
  });

  it.each([
    'url',
    'page_url',
    'page_origin',
    'host',
    'port',
    'path',
    'query',
    'fragment',
    'page_title_redacted',
    'dom',
    'text',
    'accessibility_context_redacted',
    'tab_id',
    'document_id',
    'process_id',
    'transition_qualifiers'
  ])('rejects prohibited v2 field %s', (field) => {
    expect(isBrowserEventBatchV2(withEventField(field))).toBe(false);
  });

  it.each([0, -1])('rejects non-positive sequence number %i', (sequence_number) => {
    expect(isBrowserEventBatchV2(withEventField('sequence_number', sequence_number))).toBe(false);
  });

  it('rejects a non-UUID client event identifier', () => {
    expect(isBrowserEventBatchV2(withEventField('client_event_id', 'event-v2-1'))).toBe(false);
  });

  it.each(['auto_subframe', 'manual_subframe'])('rejects subframe transition type %s', (type) => {
    expect(isBrowserEventBatchV2(withEventField('transition_type', type))).toBe(false);
  });

  it('rejects non-domain page locations', () => {
    expect(isBrowserEventBatchV2(withEventField('page_domain', 'https://example.test'))).toBe(
      false
    );
    expect(isBrowserEventBatchV2(withEventField('page_domain', 'Example.test'))).toBe(false);
  });

  it('rejects batch-level browser metadata', () => {
    expect(isBrowserEventBatchV2({ ...validFixture, tab_id: 3 })).toBe(false);
  });
});
