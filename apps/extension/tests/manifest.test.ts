import { describe, expect, it } from 'vitest';
import {
  extensionName,
  hostPermissions,
  manifestControlPlane,
  permissions
} from '../src/manifest.js';

describe('extension foundation manifest', () => {
  it('uses only control-plane permissions and blocks incognito', () => {
    expect(extensionName).toBe('Visual AI Browser Agent');
    expect(permissions).toEqual(['storage', 'alarms', 'webNavigation']);
    expect(manifestControlPlane.incognito).toBe('not_allowed');
    expect(manifestControlPlane).not.toHaveProperty('content_scripts');
  });

  it('allows only configured API and Supabase hosts', () => {
    expect(hostPermissions).toHaveLength(2);
    expect(hostPermissions).not.toContain('*://*/*');
    expect(hostPermissions.join(' ')).not.toMatch(
      /tabs|activeTab|webNavigation|history|cookies|scripting|identity|clipboard|tabCapture|desktopCapture/i
    );
  });

  it('does not request browser-content or privileged tab capabilities', () => {
    const forbidden = [
      'tabs',
      'activeTab',
      'history',
      'cookies',
      'scripting',
      'identity',
      'clipboardRead',
      'clipboardWrite',
      'tabCapture',
      'desktopCapture',
      'sidePanel'
    ];
    expect(permissions).toEqual(['storage', 'alarms', 'webNavigation']);
    expect(forbidden.some((permission) => permissions.includes(permission as never))).toBe(false);
    expect(hostPermissions).not.toContain('<all_urls>');
    expect(hostPermissions.every((permission) => !permission.startsWith('*://'))).toBe(true);
    expect(manifestControlPlane).not.toHaveProperty('content_scripts');
  });
});
