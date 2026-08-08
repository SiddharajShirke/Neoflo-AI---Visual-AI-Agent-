import { describe, expect, it } from 'vitest';
import { indicatorFor } from '../src/core/indicator.js';
import {
  protectedDomainPolicyStatement,
  popupControls,
  safeNavigationSyncView
} from '../src/entrypoints/popup/view-model.js';

describe('popup state controls', () => {
  it.each([
    ['SIGNED_OUT', false, []],
    ['READY', false, ['grant_consent', 'sign_out']],
    ['READY', true, ['withdraw_consent', 'start', 'sign_out']],
    ['STARTING', true, ['sign_out']],
    ['RECORDING', true, ['pause', 'stop', 'sign_out']],
    ['PAUSING', true, ['sign_out']],
    ['PAUSED', true, ['resume', 'stop', 'sign_out']],
    ['RESUMING', true, ['sign_out']],
    ['STOPPING', true, ['sign_out']],
    ['OFFLINE_BUFFERING', true, ['retry_sync', 'sign_out']],
    ['SYNC_ERROR', true, ['retry_sync', 'sign_out']]
  ])('enables only safe controls for %s', (kind, consentActive, enabled) => {
    const controls = popupControls({ kind, consentActive });
    expect(
      Object.entries(controls)
        .filter(([, value]) => value)
        .map(([command]) => command)
    ).toEqual(enabled);
  });
});

describe('badge and title state mapping', () => {
  it.each([
    ['READY', '', 'Ready \u2014 monitoring off'],
    ['RECORDING', 'ON', 'Monitoring session active'],
    ['PAUSED', 'II', 'Monitoring session paused'],
    ['OFFLINE_BUFFERING', '\u2026', 'Changes awaiting synchronization'],
    ['SYNC_ERROR', '!', 'Monitoring synchronization needs attention'],
    ['SIGNED_OUT', '', 'Sign in required']
  ])('maps %s to an explicit badge and title', (kind, text, title) => {
    expect(indicatorFor(kind)).toEqual({ text, title });
  });
});

describe('safe navigation sync view', () => {
  it('contains only queue count and sync state plus the non-exhaustive policy statement', () => {
    expect(safeNavigationSyncView({ pendingCount: 2, syncState: 'offline_buffering' })).toEqual({
      pendingCount: 2,
      syncState: 'offline_buffering'
    });
    expect(protectedDomainPolicyStatement).toBe(
      'The built-in protected-domain policy is a conservative, non-exhaustive protection layer. User exclusions provide additional protection.'
    );
  });

  it('rejects browser-content fields and invalid safe sync states', () => {
    expect(() =>
      safeNavigationSyncView({
        pendingCount: 1,
        syncState: 'healthy',
        pageDomain: 'example.test'
      } as never)
    ).toThrow();
    expect(() =>
      safeNavigationSyncView({ pendingCount: 1, syncState: 'recording' } as never)
    ).toThrow();
  });
});
