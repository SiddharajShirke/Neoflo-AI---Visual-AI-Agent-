export type NavigationDurationMetric =
  | 'capture_handler_ms'
  | 'normalize_filter_ms'
  | 'indexeddb_append_ms'
  | 'batch_construction_ms'
  | 'batch_http_ms';

export type NavigationIgnoredMetric =
  | 'ignored_non_http'
  | 'ignored_subframe'
  | 'ignored_invalid_domain'
  | 'ignored_user_exclusion'
  | 'ignored_protected_domain'
  | 'ignored_duplicate'
  | 'ignored_transition';

type Aggregate = { count: number; total: number; max: number };
type QueueHealth = { pending_count: number; pending_bytes: number; oldest_pending_age_ms: number };

export type NavigationMetricsSnapshot = {
  capture_handler_ms: Aggregate;
  normalize_filter_ms: Aggregate;
  indexeddb_append_ms: Aggregate;
  batch_construction_ms: Aggregate;
  batch_http_ms: Aggregate;
  batch_size: Aggregate;
  retry_count: Aggregate;
  queue: QueueHealth;
  ignored: Record<NavigationIgnoredMetric, number>;
};

const durationNames: readonly NavigationDurationMetric[] = [
  'capture_handler_ms',
  'normalize_filter_ms',
  'indexeddb_append_ms',
  'batch_construction_ms',
  'batch_http_ms'
];
const ignoredNames: readonly NavigationIgnoredMetric[] = [
  'ignored_non_http',
  'ignored_subframe',
  'ignored_invalid_domain',
  'ignored_user_exclusion',
  'ignored_protected_domain',
  'ignored_duplicate',
  'ignored_transition'
];

function aggregate(): Aggregate {
  return { count: 0, total: 0, max: 0 };
}

function assertNonNegativeFinite(value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error('metric must be non-negative and finite');
}

/** In-memory fixed-shape aggregates only. No content, identifiers, samples, or telemetry. */
export class NavigationMetrics {
  private readonly durations = Object.fromEntries(
    durationNames.map((name) => [name, aggregate()])
  ) as Record<NavigationDurationMetric, Aggregate>;
  private readonly ignored = Object.fromEntries(ignoredNames.map((name) => [name, 0])) as Record<
    NavigationIgnoredMetric,
    number
  >;
  private readonly batchSize = aggregate();
  private readonly retryCount = aggregate();
  private queue: QueueHealth = { pending_count: 0, pending_bytes: 0, oldest_pending_age_ms: 0 };

  recordDuration(name: NavigationDurationMetric, value: number): void {
    assertNonNegativeFinite(value);
    this.record(this.durations[name], value);
  }

  recordBatchSize(value: number): void {
    assertNonNegativeFinite(value);
    this.record(this.batchSize, value);
  }

  recordRetryCount(value: number): void {
    assertNonNegativeFinite(value);
    this.record(this.retryCount, value);
  }

  incrementIgnored(reason: NavigationIgnoredMetric): void {
    this.ignored[reason] += 1;
  }

  setQueueHealth(value: {
    pendingCount: number;
    pendingBytes: number;
    oldestPendingAgeMs: number;
  }): void {
    assertNonNegativeFinite(value.pendingCount);
    assertNonNegativeFinite(value.pendingBytes);
    assertNonNegativeFinite(value.oldestPendingAgeMs);
    this.queue = {
      pending_count: value.pendingCount,
      pending_bytes: value.pendingBytes,
      oldest_pending_age_ms: value.oldestPendingAgeMs
    };
  }

  toJSON(): NavigationMetricsSnapshot {
    return {
      capture_handler_ms: { ...this.durations.capture_handler_ms },
      normalize_filter_ms: { ...this.durations.normalize_filter_ms },
      indexeddb_append_ms: { ...this.durations.indexeddb_append_ms },
      batch_construction_ms: { ...this.durations.batch_construction_ms },
      batch_http_ms: { ...this.durations.batch_http_ms },
      batch_size: { ...this.batchSize },
      retry_count: { ...this.retryCount },
      queue: { ...this.queue },
      ignored: { ...this.ignored }
    };
  }

  private record(target: Aggregate, value: number): void {
    target.count += 1;
    target.total += value;
    target.max = Math.max(target.max, value);
  }
}
