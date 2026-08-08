import { describe, expect, it } from 'vitest';
import { NavigationDuplicateCache } from '../src/navigation/duplicate-cache.js';

describe('NavigationDuplicateCache', () => {
  it('suppresses a transient key only within its TTL', () => {
    const cache = new NavigationDuplicateCache({ capacity: 4, ttlMs: 100 });

    expect(cache.seen('transient-a', 1_000)).toBe(false);
    expect(cache.seen('transient-a', 1_099)).toBe(true);
    expect(cache.seen('transient-a', 1_100)).toBe(false);
  });

  it('evicts the oldest key deterministically at capacity', () => {
    const cache = new NavigationDuplicateCache({ capacity: 2, ttlMs: 1_000 });

    expect(cache.seen('first', 0)).toBe(false);
    expect(cache.seen('second', 1)).toBe(false);
    expect(cache.seen('third', 2)).toBe(false);
    expect(cache.seen('first', 3)).toBe(false);
    expect(cache.seen('third', 4)).toBe(true);
  });

  it('starts empty after worker-style reconstruction', () => {
    const firstWorker = new NavigationDuplicateCache({ capacity: 2, ttlMs: 1_000 });
    expect(firstWorker.seen('transient', 0)).toBe(false);
    expect(firstWorker.seen('transient', 1)).toBe(true);

    const restartedWorker = new NavigationDuplicateCache({ capacity: 2, ttlMs: 1_000 });
    expect(restartedWorker.seen('transient', 1)).toBe(false);
  });
});
