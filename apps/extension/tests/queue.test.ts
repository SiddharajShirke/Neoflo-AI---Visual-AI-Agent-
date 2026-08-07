import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS,
  nextRetryDelayMs,
  retryAfterDelayMs,
  shouldRetryStatus
} from '../src/queue/retry.js';
import { createPendingMutation } from '../src/queue/mutations.js';

describe('offline retry policy', () => {
  it('uses bounded five-second exponential backoff with full jitter', () => {
    expect(nextRetryDelayMs(0, 0)).toBe(0);
    expect(nextRetryDelayMs(0, 0.5)).toBe(2_500);
    expect(nextRetryDelayMs(0, 1)).toBe(5_000);
    expect(nextRetryDelayMs(20, 1)).toBe(300_000);
    expect(MAX_ATTEMPTS).toBe(7);
  });

  it('honours only bounded valid Retry-After values', () => {
    expect(retryAfterDelayMs('30')).toBe(30_000);
    expect(retryAfterDelayMs('999999')).toBe(300_000);
    expect(retryAfterDelayMs('invalid')).toBeNull();
    expect(retryAfterDelayMs('1.5')).toBeNull();
  });

  it('retries transport and transient failures but never permanent API failures', () => {
    expect(shouldRetryStatus(undefined)).toBe(true);
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(500)).toBe(true);
    expect(shouldRetryStatus(409)).toBe(false);
    expect(shouldRetryStatus(422)).toBe(false);
  });

  it('binds payload identity to SHA-256 independent of object key order', async () => {
    const first = await createPendingMutation(
      'pause_session',
      { session_id: 's-1', reason: 'user' },
      new Date('2026-08-07T00:00:00.000Z'),
      () => 'operation-1'
    );
    const samePayload = await createPendingMutation(
      'pause_session',
      { reason: 'user', session_id: 's-1' },
      new Date('2026-08-07T00:00:00.000Z'),
      () => 'operation-2'
    );
    const changedPayload = await createPendingMutation(
      'pause_session',
      { session_id: 's-1', reason: 'automatic' },
      new Date('2026-08-07T00:00:00.000Z'),
      () => 'operation-3'
    );
    expect(first.payload_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.payload_sha256).toBe(samePayload.payload_sha256);
    expect(first.payload_sha256).not.toBe(changedPayload.payload_sha256);
  });
});
