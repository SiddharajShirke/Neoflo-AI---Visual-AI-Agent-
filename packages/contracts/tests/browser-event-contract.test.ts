import batchSchema from '../../../schemas/events/browser-event-batch.v1.schema.json';
import validFixture from '../../../schemas/events/fixtures/browser-event-batch.v1.valid.json';
import invalidFixture from '../../../schemas/events/fixtures/browser-event-batch.v1.invalid-sensitive-field.json';
import { describe, expect, it } from 'vitest';
import { isBrowserEventBatch, isEventIngestionResponse } from '../src/index.js';

describe('browser event batch contract', () => {
  it('accepts the shared minimized fixture', () => {
    expect(batchSchema.additionalProperties).toBe(false);
    expect(isBrowserEventBatch(validFixture)).toBe(true);
  });

  it('rejects an unknown sensitive field', () => {
    expect(isBrowserEventBatch(invalidFixture)).toBe(false);
  });

  it('accepts only safe event ingestion response metadata', () => {
    expect(isEventIngestionResponse({ accepted_count: 1, duplicate_count: 0 })).toBe(true);
    expect(
      isEventIngestionResponse({ accepted_count: 1, duplicate_count: 0, raw_url: 'https://x' })
    ).toBe(false);
  });
});
