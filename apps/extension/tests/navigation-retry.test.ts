import { describe, expect, it } from 'vitest';
import {
  MAX_NAVIGATION_RETRY_DELAY_MS,
  isNavigationRetryable,
  navigationRetryAfterDelayMs,
  navigationRetryDelayMs
} from '../src/navigation/retry.js';

describe('navigation delivery retry policy', () => {
  it.each([undefined, 0, 408, 425, 429, 500, 503])('retries status %s', (status) => {
    expect(isNavigationRetryable(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])('does not retry permanent status %s', (status) => {
    expect(isNavigationRetryable(status)).toBe(false);
  });

  it('uses full jitter whose first retry is capped at five seconds and later retries at five minutes', () => {
    expect(navigationRetryDelayMs(1, 0)).toBe(0);
    expect(navigationRetryDelayMs(1, 1)).toBe(5_000);
    expect(navigationRetryDelayMs(7, 1)).toBe(MAX_NAVIGATION_RETRY_DELAY_MS);
  });

  it('honours numeric Retry-After only within the five-minute bound', () => {
    expect(navigationRetryAfterDelayMs('30')).toBe(30_000);
    expect(navigationRetryAfterDelayMs('999999')).toBe(MAX_NAVIGATION_RETRY_DELAY_MS);
    expect(navigationRetryAfterDelayMs('invalid')).toBeNull();
  });
});
