import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExtensionManifest } from './check-extension-manifest.mjs';

const valid = {
  manifest_version: 3,
  permissions: ['storage', 'alarms', 'webNavigation'],
  host_permissions: ['http://localhost:8000/*', 'https://project.supabase.co/*'],
  incognito: 'not_allowed'
};

test('accepts only the emitted M4 navigation manifest boundary', () => {
  assert.deepEqual(validateExtensionManifest(valid), []);
});

test('rejects missing webNavigation and forbidden manifest surface', () => {
  for (const manifest of [
    { ...valid, permissions: ['storage', 'alarms'] },
    { ...valid, permissions: [...valid.permissions, 'tabs'] },
    { ...valid, host_permissions: ['<all_urls>'] },
    { ...valid, content_scripts: [{ matches: ['https://example.test/*'] }] },
    { ...valid, incognito: 'spanning' }
  ]) {
    assert.notDeepEqual(validateExtensionManifest(manifest), []);
  }
});
