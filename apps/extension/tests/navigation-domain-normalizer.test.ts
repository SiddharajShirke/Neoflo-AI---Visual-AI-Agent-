import { isBrowserEventV2 } from '@visual-ai/contracts';
import { parse } from 'tldts';
import { describe, expect, it } from 'vitest';
import { normalizeNavigationUrl } from '../src/privacy/domain-normalizer.js';

const parserOptions = { allowPrivateDomains: false } as const;

function isAcceptedBrowserEventDomain(pageDomain: string): boolean {
  return isBrowserEventV2({
    client_event_id: '11111111-1111-4111-8111-111111111111',
    sequence_number: 1,
    event_kind: 'navigation',
    occurred_at: '2026-08-08T10:00:00Z',
    page_domain: pageDomain,
    transition_type: 'link',
    capture_policy_version: 'm4-navigation-v1'
  });
}

describe('tldts dependency contract', () => {
  it('returns the ICANN registrable domain with private suffixes disabled', () => {
    expect(parse('a.b.example.co.uk', parserOptions).domain).toBe('example.co.uk');
    expect(parse('co.uk', parserOptions).domain).toBeNull();
    expect(parse('localhost', parserOptions).domain).toBeNull();
    expect(parse('127.0.0.1', parserOptions).domain).toBeNull();
    expect(parse('[::1]', parserOptions).domain).toBeNull();
    expect(parse('printer.local', parserOptions).isIcann).toBe(false);
    expect(parse('foo.github.io', parserOptions).domain).toBe('github.io');
  });
});

describe('navigation domain normalization', () => {
  it.each([
    ['strips a www host prefix', 'https://www.example.com/path', 'example.com', 'www.example.com'],
    [
      'normalizes uppercase hosts',
      'HTTPS://WWW.EXAMPLE.COM/path',
      'example.com',
      'www.example.com'
    ],
    [
      'does not return URL path query or fragment data',
      'https://a.example.com/path?q=value#fragment',
      'example.com',
      'a.example.com'
    ],
    [
      'accepts an IDN only when BrowserEventV2 accepts the normalized output',
      'https://www.éxample.com',
      'xn--xample-9ua.com',
      'www.xn--xample-9ua.com'
    ]
  ])('%s', (_name, rawUrl, pageDomain, matchingHostname) => {
    expect(normalizeNavigationUrl(rawUrl)).toEqual({
      kind: 'accepted',
      pageDomain,
      matchingHostname
    });
    expect(isAcceptedBrowserEventDomain(pageDomain)).toBe(true);
  });

  it.each([
    ['chrome scheme', 'chrome://settings', 'non_http'],
    ['data scheme', 'data:text/plain,ignored', 'non_http'],
    ['javascript scheme', 'javascript:alert(1)', 'non_http'],
    ['file scheme', 'file:///private.txt', 'non_http'],
    ['credentials', 'https://person:secret@example.com', 'invalid_domain'],
    ['localhost', 'http://localhost', 'invalid_domain'],
    ['local domain', 'https://printer.local', 'invalid_domain'],
    ['IPv4 literal', 'http://127.0.0.1', 'invalid_domain'],
    ['IPv6 literal', 'http://[::1]', 'invalid_domain'],
    ['single-label host', 'http://intranet', 'invalid_domain'],
    ['public suffix', 'https://co.uk', 'invalid_domain'],
    ['malformed URL', 'https://example .com', 'invalid_domain'],
    ['unsupported IDN TLD output', 'https://www.пример.рф', 'invalid_domain']
  ])('%s is ignored', (_name, rawUrl, reason) => {
    expect(normalizeNavigationUrl(rawUrl)).toEqual({ kind: 'ignored', reason });
  });
});
