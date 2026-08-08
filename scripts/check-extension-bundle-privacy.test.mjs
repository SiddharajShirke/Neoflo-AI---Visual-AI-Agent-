import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBundleText } from './check-extension-bundle-privacy.mjs';

test('accepts a clean synthetic extension bundle', () => {
  assert.deepEqual(validateBundleText('const capability = chrome.webNavigation;'), []);
});

test('rejects privileged capability, service role, content-script, and raw navigation fixture markers', () => {
  for (const source of [
    'const key = "SUPABASE_SERVICE_ROLE_KEY";',
    'chrome.tabs.query({});',
    'const content_scripts = [];',
    'raw-navigation-fixture:https://private.example.test/path?secret=value'
  ]) {
    assert.notDeepEqual(validateBundleText(source), []);
  }
});
