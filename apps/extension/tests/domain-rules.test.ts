import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DomainRuleRepository, normalizeExcludedDomain } from '../src/persistence/domain-rules.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';

describe('future-only excluded domains', () => {
  it('normalizes a user-entered domain without accepting a path or URL', () => {
    expect(normalizeExcludedDomain(' HTTPS://Example.COM ')).toBe('example.com');
    expect(() => normalizeExcludedDomain('example.com/path')).toThrow('domain');
  });

  it('persists only normalized user exclusions and can remove them', async () => {
    const database = await openControlPlaneDatabase(`domains-${crypto.randomUUID()}`);
    const rules = new DomainRuleRepository(database);
    await rules.add('https://Example.COM');
    expect(await rules.list()).toEqual(['example.com']);
    await rules.remove('example.com');
    expect(await rules.list()).toEqual([]);
    database.close();
  });
});
