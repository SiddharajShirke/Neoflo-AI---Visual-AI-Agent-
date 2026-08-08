import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredPermissions = ['storage', 'alarms', 'webNavigation'];
const forbiddenPermissions = new Set([
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
]);

export function validateExtensionManifest(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['manifest must be an object'];
  const manifest = value;
  if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
  if (
    !Array.isArray(manifest.permissions) ||
    manifest.permissions.length !== requiredPermissions.length ||
    !requiredPermissions.every((permission) => manifest.permissions.includes(permission))
  ) {
    errors.push('permissions must be exactly storage, alarms, webNavigation');
  }
  if (
    Array.isArray(manifest.permissions) &&
    manifest.permissions.some((item) => forbiddenPermissions.has(item))
  )
    errors.push('forbidden browser permission');
  if (manifest.incognito !== 'not_allowed') errors.push('incognito must be not_allowed');
  if ('content_scripts' in manifest) errors.push('content scripts are prohibited');
  if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.length !== 2)
    errors.push('exact API and Supabase host permissions required');
  else if (
    manifest.host_permissions.some(
      (permission) =>
        typeof permission !== 'string' ||
        permission === '<all_urls>' ||
        permission.startsWith('*://') ||
        !/^https?:\/\/[^/*]+\/\*$/.test(permission)
    )
  ) {
    errors.push('wildcard or invalid host permission');
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidates = [
    resolve('apps/extension/.output/chrome-mv3/manifest.json'),
    resolve('.output/chrome-mv3/manifest.json')
  ];
  const manifestPath = candidates.find(existsSync);
  if (!manifestPath) {
    console.error('Built extension manifest was not found. Run the extension build first.');
    process.exitCode = 1;
  } else {
    const errors = validateExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
    if (errors.length > 0) {
      console.error(`Extension manifest check failed: ${errors.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log('Extension manifest check passed.');
    }
  }
}
