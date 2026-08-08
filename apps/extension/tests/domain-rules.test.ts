import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  DomainRuleRepository,
  matchesDomainRule,
  normalizeExcludedDomain
} from '../src/persistence/domain-rules.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';
import { matchProtectedHostname } from '../src/privacy/protected-domain-policy.js';

describe('future-only excluded domains', () => {
  it.each([
    ['matches the exact hostname', 'example.com', 'example.com', true],
    ['matches a dot-boundary subdomain', 'a.example.com', 'example.com', true],
    ['rejects a lookalike suffix', 'notexample.com', 'example.com', false],
    ['rejects a different suffix', 'example.com.evil.test', 'example.com', false]
  ])('%s', (_name, hostname, rule, expected) => {
    expect(matchesDomainRule(hostname, rule)).toBe(expected);
  });

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

  it('allows a user rule to add protection without overriding system protection', async () => {
    const database = await openControlPlaneDatabase(`domains-${crypto.randomUUID()}`);
    const rules = new DomainRuleRepository(database);

    await rules.add('accounts.google.com');

    expect(await rules.list()).toEqual(['accounts.google.com']);
    expect(matchProtectedHostname('accounts.google.com')).toBe('authentication_account_recovery');
    database.close();
  });
});
