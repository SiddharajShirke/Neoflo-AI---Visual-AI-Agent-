import { describe, expect, it } from 'vitest';
import { NavigationMetrics } from '../src/navigation/metrics.js';

describe('navigation aggregate metrics', () => {
  it('serializes only bounded aggregate timings, counts, and queue health', () => {
    const metrics = new NavigationMetrics();
    metrics.recordDuration('capture_handler_ms', 3.5);
    metrics.recordDuration('normalize_filter_ms', 1.25);
    metrics.recordDuration('indexeddb_append_ms', 8);
    metrics.recordDuration('batch_construction_ms', 2);
    metrics.recordDuration('batch_http_ms', 44);
    metrics.recordBatchSize(2);
    metrics.recordRetryCount(1);
    metrics.setQueueHealth({ pendingCount: 2, pendingBytes: 321, oldestPendingAgeMs: 50 });
    metrics.incrementIgnored('ignored_protected_domain');

    const serialized = metrics.toJSON();

    expect(serialized).toEqual({
      capture_handler_ms: { count: 1, total: 3.5, max: 3.5 },
      normalize_filter_ms: { count: 1, total: 1.25, max: 1.25 },
      indexeddb_append_ms: { count: 1, total: 8, max: 8 },
      batch_construction_ms: { count: 1, total: 2, max: 2 },
      batch_http_ms: { count: 1, total: 44, max: 44 },
      batch_size: { count: 1, total: 2, max: 2 },
      retry_count: { count: 1, total: 1, max: 1 },
      queue: { pending_count: 2, pending_bytes: 321, oldest_pending_age_ms: 50 },
      ignored: {
        ignored_non_http: 0,
        ignored_subframe: 0,
        ignored_invalid_domain: 0,
        ignored_user_exclusion: 0,
        ignored_protected_domain: 1,
        ignored_duplicate: 0,
        ignored_transition: 0
      }
    });
    expect(JSON.stringify(serialized)).not.toMatch(
      /example\.test|private\/path|synthetic-document|10000000-0000-4000-8000-000000000001|opaque-token/i
    );
  });

  it('rejects non-finite values and negative queue health instead of retaining unbounded samples', () => {
    const metrics = new NavigationMetrics();

    expect(() => metrics.recordDuration('capture_handler_ms', Number.NaN)).toThrow();
    expect(() => metrics.recordBatchSize(-1)).toThrow();
    expect(() =>
      metrics.setQueueHealth({ pendingCount: -1, pendingBytes: 0, oldestPendingAgeMs: 0 })
    ).toThrow();
  });
});
