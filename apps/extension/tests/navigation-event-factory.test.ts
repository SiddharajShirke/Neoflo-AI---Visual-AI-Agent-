import { isBrowserEventV2, type BrowserEventV2 } from '@visual-ai/contracts';
import { describe, expect, it } from 'vitest';
import { createNavigationEvent } from '../src/navigation/event-factory.js';

const transitions: BrowserEventV2['transition_type'][] = [
  'link',
  'typed',
  'auto_bookmark',
  'generated',
  'start_page',
  'form_submit',
  'reload',
  'keyword',
  'keyword_generated'
];

describe('createNavigationEvent', () => {
  it.each(transitions)('constructs the exact valid v2 draft for %s', (transitionType) => {
    const draft = createNavigationEvent({
      pageDomain: 'example.com',
      transitionType,
      occurredAt: new Date('2026-08-08T01:02:03.004Z')
    });

    expect(Object.keys(draft).sort()).toEqual(
      [
        'capture_policy_version',
        'client_event_id',
        'event_kind',
        'occurred_at',
        'page_domain',
        'transition_type'
      ].sort()
    );
    expect(draft).toMatchObject({
      event_kind: 'navigation',
      occurred_at: '2026-08-08T01:02:03.004Z',
      page_domain: 'example.com',
      transition_type: transitionType,
      capture_policy_version: 'm4-navigation-v1'
    });
    expect(draft.client_event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(isBrowserEventV2({ ...draft, sequence_number: 1 })).toBe(true);
  });

  it('rejects a transition outside the BrowserEventV2 allowlist', () => {
    expect(() =>
      createNavigationEvent({
        pageDomain: 'example.com',
        transitionType: 'server_redirect' as BrowserEventV2['transition_type'],
        occurredAt: new Date('2026-08-08T01:02:03.004Z')
      })
    ).toThrow('invalid navigation event input');
  });
});
