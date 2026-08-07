export const BASE_RETRY_DELAY_MS = 5_000;
export const MAX_RETRY_DELAY_MS = 300_000;
export const MAX_ATTEMPTS = 7;

/** Full-jitter exponential backoff. `jitter` is injectable to keep tests deterministic. */
export function nextRetryDelayMs(retryCount: number, jitter = Math.random()): number {
  const ceiling = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** Math.max(0, retryCount));
  return Math.floor(ceiling * Math.min(1, Math.max(0, jitter)));
}

export function retryAfterDelayMs(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  return Math.min(MAX_RETRY_DELAY_MS, Number(value) * 1_000);
}

export function shouldRetryStatus(status: number | undefined): boolean {
  return (
    status === undefined ||
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}
