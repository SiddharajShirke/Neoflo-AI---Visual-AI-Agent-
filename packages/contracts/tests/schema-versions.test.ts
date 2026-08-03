import { describe, expect, it } from 'vitest';
import { schemaVersions } from '../src/index.js';

describe('schemaVersions', () => {
  it('publishes the foundation health contract version', () => {
    expect(schemaVersions.healthResponse).toBe('v1');
  });
});
