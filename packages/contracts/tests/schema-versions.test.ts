import { describe, expect, it } from 'vitest';
import { isBrowserEventBatch, isBrowserEventBatchV2, schemaVersions } from '../src/index.js';
import v1Fixture from '../../../schemas/events/fixtures/browser-event-batch.v1.valid.json';
import v2Fixture from '../../../schemas/events/fixtures/browser-event-batch.v2.valid.json';

describe('schemaVersions', () => {
  it('publishes the foundation health contract version', () => {
    expect(schemaVersions.healthResponse).toBe('v1');
  });

  it('publishes the control-plane contract version', () => {
    expect(schemaVersions.controlPlane).toBe('v1');
  });

  it('keeps v1 and publishes v2 independently', () => {
    expect(schemaVersions.browserEvent).toBe('v1');
    expect(schemaVersions.browserEventV2).toBe('v2');
    expect(isBrowserEventBatch(v1Fixture)).toBe(true);
    expect(isBrowserEventBatchV2(v1Fixture)).toBe(false);
    expect(isBrowserEventBatchV2(v2Fixture)).toBe(true);
  });
});
