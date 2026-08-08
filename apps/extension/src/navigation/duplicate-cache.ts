/** Optimization-only, bounded worker memory. Nothing in this cache is persisted. */
export class NavigationDuplicateCache {
  private readonly expirations = new Map<string, number>();

  constructor(private readonly options = { capacity: 256, ttlMs: 5_000 }) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1 || options.ttlMs < 1) {
      throw new Error('duplicate cache requires positive capacity and TTL');
    }
  }

  seen(key: string, nowMs: number): boolean {
    const expiresAt = this.expirations.get(key);
    if (expiresAt !== undefined && nowMs < expiresAt) return true;
    if (expiresAt !== undefined) this.expirations.delete(key);

    while (this.expirations.size >= this.options.capacity) {
      const oldest = this.expirations.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.expirations.delete(oldest);
    }
    this.expirations.set(key, nowMs + this.options.ttlMs);
    return false;
  }
}
