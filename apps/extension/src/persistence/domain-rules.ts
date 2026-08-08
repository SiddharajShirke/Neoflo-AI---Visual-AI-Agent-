/** Local future-monitoring exclusions only. This module never reads browser URLs. */
import type { ControlPlaneDatabase } from './database.js';

function normalizeHostnameForMatching(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function matchesDomainRule(hostname: string, rule: string): boolean {
  const normalizedHostname = normalizeHostnameForMatching(hostname);
  const normalizedRule = normalizeHostnameForMatching(rule);
  if (!normalizedHostname || !normalizedRule) return false;
  return normalizedHostname === normalizedRule || normalizedHostname.endsWith(`.${normalizedRule}`);
}

export function normalizeExcludedDomain(value: string): string {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(trimmed))
    throw new Error('A normalized domain is required.');
  return trimmed;
}

export const protectedCategories = [
  'Authentication and account recovery',
  'Payment and health services'
] as const;

export class DomainRuleRepository {
  constructor(private readonly database: ControlPlaneDatabase) {}

  async list(): Promise<string[]> {
    const rows = await this.database.getAll<{ id: string; domain?: string }>('domain_rules');
    return rows
      .map((row) => row.domain)
      .filter((domain): domain is string => typeof domain === 'string')
      .sort();
  }

  async add(input: string): Promise<string> {
    const domain = normalizeExcludedDomain(input);
    await this.database.put('domain_rules', { id: domain, domain, source: 'user' });
    return domain;
  }

  async remove(domain: string): Promise<void> {
    // Keys are normalized locally; protected categories never enter this store.
    await this.database.delete('domain_rules', normalizeExcludedDomain(domain));
  }
}
