import healthSchema from '../../schemas/api/health-response.v1.schema.json';
import { describe, expect, it } from 'vitest';

describe('health response schema', () => {
  it('requires an ok status and non-empty service name', () => {
    expect(healthSchema.required).toEqual(['status', 'service']);
    expect(healthSchema.properties.status).toEqual({ const: 'ok' });
  });
});
