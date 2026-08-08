import {
  MAX_RETRY_DELAY_MS,
  nextRetryDelayMs,
  retryAfterDelayMs,
  shouldRetryStatus
} from '../queue/retry.js';

export const MAX_NAVIGATION_RETRY_DELAY_MS = MAX_RETRY_DELAY_MS;

/** `totalSends` includes the initial HTTP call, so retry one has a 5s ceiling. */
export function navigationRetryDelayMs(totalSends: number, jitter = Math.random()): number {
  return nextRetryDelayMs(Math.max(0, totalSends - 1), jitter);
}

export function navigationRetryAfterDelayMs(value: string | null): number | null {
  return retryAfterDelayMs(value);
}

export function isNavigationRetryable(status: number | undefined): boolean {
  return shouldRetryStatus(status);
}
