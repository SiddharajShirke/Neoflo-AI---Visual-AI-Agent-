import { isBrowserEventV2 } from '@visual-ai/contracts';
import { parse } from 'tldts';

export type NormalizeResult =
  | { kind: 'accepted'; pageDomain: string; matchingHostname: string }
  | { kind: 'ignored'; reason: 'non_http' | 'invalid_domain' };

const parserOptions = { allowPrivateDomains: false } as const;

function isValidPageDomain(pageDomain: string): boolean {
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

export function normalizeNavigationUrl(rawUrl: string): NormalizeResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'ignored', reason: 'invalid_domain' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { kind: 'ignored', reason: 'non_http' };
  }

  if (url.username !== '' || url.password !== '') {
    return { kind: 'ignored', reason: 'invalid_domain' };
  }

  const matchingHostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const { domain, isIcann } = parse(matchingHostname, parserOptions);
  if (domain === null || !isIcann || !isValidPageDomain(domain)) {
    return { kind: 'ignored', reason: 'invalid_domain' };
  }

  return { kind: 'accepted', pageDomain: domain, matchingHostname };
}
