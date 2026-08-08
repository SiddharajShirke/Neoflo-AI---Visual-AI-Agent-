import runtimeArtifact from './protected-domains-v1.json';

export type ProtectedCategory = 'authentication_account_recovery' | 'payments_financial' | 'health';

export type ProtectedMatchType = 'exact' | 'suffix';

export type ProtectedDomainRule = {
  category: ProtectedCategory;
  domain: string;
  match_type: ProtectedMatchType;
};

export type ProtectedDomainPolicy = {
  policy_version: 'protected-domains-v1';
  provenance: {
    type: 'first-party-curated';
    owner: 'Neoflo Security & Privacy';
    reviewed_at: '2026-08-08';
    description: 'Manually reviewed conservative seed rules.';
  };
  rules: ProtectedDomainRule[];
};

const POLICY_KEYS = ['policy_version', 'provenance', 'rules'] as const;
const PROVENANCE_KEYS = ['type', 'owner', 'reviewed_at', 'description'] as const;
const RULE_KEYS = ['category', 'domain', 'match_type'] as const;
const protectedCategories = new Set<ProtectedCategory>([
  'authentication_account_recovery',
  'payments_financial',
  'health'
]);
const protectedMatchTypes = new Set<ProtectedMatchType>(['exact', 'suffix']);
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const valueKeys = Object.keys(value);
  return valueKeys.length === keys.length && valueKeys.every((key) => keys.includes(key));
}

function isProtectedCategory(value: unknown): value is ProtectedCategory {
  return typeof value === 'string' && protectedCategories.has(value as ProtectedCategory);
}

function isProtectedMatchType(value: unknown): value is ProtectedMatchType {
  return typeof value === 'string' && protectedMatchTypes.has(value as ProtectedMatchType);
}

function isPolicyDomain(value: unknown): value is string {
  return typeof value === 'string' && domainPattern.test(value);
}

function invalidPolicy(): never {
  throw new Error('Invalid protected domain policy');
}

function matchesDotBoundary(hostname: string, domain: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, '');
  const normalizedDomain = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!normalizedHostname || !normalizedDomain) return false;
  return (
    normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

export function loadProtectedDomainPolicy(value: unknown): ProtectedDomainPolicy {
  if (!isRecord(value) || !hasOnlyKeys(value, POLICY_KEYS)) {
    return invalidPolicy();
  }

  if (
    value.policy_version !== 'protected-domains-v1' ||
    !isRecord(value.provenance) ||
    !hasOnlyKeys(value.provenance, PROVENANCE_KEYS) ||
    value.provenance.type !== 'first-party-curated' ||
    value.provenance.owner !== 'Neoflo Security & Privacy' ||
    value.provenance.reviewed_at !== '2026-08-08' ||
    value.provenance.description !== 'Manually reviewed conservative seed rules.' ||
    !Array.isArray(value.rules)
  ) {
    return invalidPolicy();
  }

  const duplicateKeys = new Set<string>();
  const rules: ProtectedDomainRule[] = [];

  for (const rule of value.rules) {
    if (
      !isRecord(rule) ||
      !hasOnlyKeys(rule, RULE_KEYS) ||
      !isProtectedCategory(rule.category) ||
      !isPolicyDomain(rule.domain) ||
      !isProtectedMatchType(rule.match_type)
    ) {
      return invalidPolicy();
    }

    const duplicateKey = `${rule.domain}\u0000${rule.match_type}`;
    if (duplicateKeys.has(duplicateKey)) {
      return invalidPolicy();
    }
    duplicateKeys.add(duplicateKey);
    rules.push({
      category: rule.category,
      domain: rule.domain,
      match_type: rule.match_type
    });
  }

  return {
    policy_version: 'protected-domains-v1',
    provenance: {
      type: 'first-party-curated',
      owner: 'Neoflo Security & Privacy',
      reviewed_at: '2026-08-08',
      description: 'Manually reviewed conservative seed rules.'
    },
    rules
  };
}

const protectedDomainPolicy = loadProtectedDomainPolicy(runtimeArtifact);

export function matchProtectedHostname(hostname: string): ProtectedCategory | null {
  for (const rule of protectedDomainPolicy.rules) {
    const matches =
      rule.match_type === 'exact'
        ? hostname.trim().toLowerCase().replace(/\.$/, '') === rule.domain
        : matchesDotBoundary(hostname, rule.domain);
    if (matches) return rule.category;
  }
  return null;
}
