import { describe, expect, it } from 'vitest';
import runtimeArtifact from '../src/privacy/protected-domains-v1.json';
import {
  loadProtectedDomainPolicy,
  matchProtectedHostname
} from '../src/privacy/protected-domain-policy.js';

function clonedArtifact(): Record<string, unknown> {
  return structuredClone(runtimeArtifact) as Record<string, unknown>;
}

function rulesOf(policy: Record<string, unknown>): Array<Record<string, unknown>> {
  return policy.rules as Array<Record<string, unknown>>;
}

describe('protected domain policy', () => {
  it.each([
    ['matches Google exact rule', 'accounts.google.com', 'authentication_account_recovery'],
    ['does not match a Google lookalike', 'notaccounts.google.com', null],
    ['does not match a Google nested hostname', 'a.accounts.google.com', null],
    ['matches Bank of America suffix rule', 'login.secure.bankofamerica.com', 'payments_financial'],
    [
      'does not match a Bank of America lookalike suffix',
      'secure.bankofamerica.com.evil.test',
      null
    ]
  ])('%s', (_name, hostname, expected) => {
    expect(matchProtectedHostname(hostname)).toBe(expected);
  });

  it('loads the approved first-party metadata and six conservative seed rules', () => {
    expect(loadProtectedDomainPolicy(runtimeArtifact)).toEqual({
      policy_version: 'protected-domains-v1',
      provenance: {
        type: 'first-party-curated',
        owner: 'Neoflo Security & Privacy',
        reviewed_at: '2026-08-08',
        description: 'Manually reviewed conservative seed rules.'
      },
      rules: [
        {
          category: 'authentication_account_recovery',
          domain: 'accounts.google.com',
          match_type: 'exact'
        },
        {
          category: 'authentication_account_recovery',
          domain: 'login.microsoftonline.com',
          match_type: 'exact'
        },
        {
          category: 'authentication_account_recovery',
          domain: 'account.apple.com',
          match_type: 'exact'
        },
        {
          category: 'payments_financial',
          domain: 'www.paypal.com',
          match_type: 'exact'
        },
        {
          category: 'payments_financial',
          domain: 'secure.bankofamerica.com',
          match_type: 'suffix'
        },
        {
          category: 'health',
          domain: 'portal.athenahealth.com',
          match_type: 'suffix'
        }
      ]
    });
  });

  it.each([
    [
      'unknown category',
      { category: 'social', domain: 'accounts.google.com', match_type: 'exact' }
    ],
    [
      'unknown match type',
      { category: 'health', domain: 'portal.athenahealth.com', match_type: 'contains' }
    ]
  ])('rejects a rule with an %s', (_name, replacementRule) => {
    const policy = clonedArtifact();
    rulesOf(policy)[0] = replacementRule;

    expect(() => loadProtectedDomainPolicy(policy)).toThrow();
  });

  it('rejects an artifact without provenance', () => {
    const policy = clonedArtifact();
    delete policy.provenance;

    expect(() => loadProtectedDomainPolicy(policy)).toThrow();
  });

  it.each([
    ['non-lowercase domain', 'Accounts.Google.com'],
    ['malformed domain', 'accounts..google.com'],
    ['URL-like scheme', 'https://accounts.google.com'],
    ['URL-like path', 'accounts.google.com/login'],
    ['URL-like port', 'accounts.google.com:443']
  ])('rejects a %s in a rule', (_name, domain) => {
    const policy = clonedArtifact();
    rulesOf(policy)[0].domain = domain;

    expect(() => loadProtectedDomainPolicy(policy)).toThrow();
  });

  it('rejects an evidence URL in the runtime artifact', () => {
    const policy = clonedArtifact();
    policy.evidence_url = 'https://evidence.example.test/protected-domain-review';

    expect(() => loadProtectedDomainPolicy(policy)).toThrow();
  });

  it('rejects duplicate domain and match-type pairs', () => {
    const policy = clonedArtifact();
    rulesOf(policy)[1] = {
      category: 'health',
      domain: 'accounts.google.com',
      match_type: 'exact'
    };

    expect(() => loadProtectedDomainPolicy(policy)).toThrow();
  });
});
