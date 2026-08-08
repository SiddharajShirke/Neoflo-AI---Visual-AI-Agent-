import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const prohibitedBundleMarkers = [
  /SUPABASE_SERVICE_ROLE(?:_KEY)?/i,
  /chrome\.(?:tabs|history|cookies|scripting|identity|tabCapture|desktopCapture)\b/,
  /\bcontent_scripts\b/,
  /raw-navigation-fixture:/i
];

export function validateBundleText(source) {
  if (typeof source !== 'string') return ['bundle source must be text'];
  return prohibitedBundleMarkers
    .filter((marker) => marker.test(source))
    .map((marker) => `prohibited built-bundle marker: ${marker}`);
}

function textFilesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return textFilesUnder(path);
    return ['.js', '.mjs', '.cjs', '.html', '.css'].includes(extname(entry.name)) ? [path] : [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidates = [resolve('apps/extension/.output/chrome-mv3'), resolve('.output/chrome-mv3')];
  const outputDirectory = candidates.find(existsSync);
  if (!outputDirectory) {
    console.error('Built extension bundle was not found. Run the extension build first.');
    process.exitCode = 1;
  } else {
    const failures = textFilesUnder(outputDirectory).flatMap((path) =>
      validateBundleText(readFileSync(path, 'utf8')).map((error) => `${path}: ${error}`)
    );
    if (failures.length > 0) {
      console.error(`Extension bundle privacy check failed:\n${failures.join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log('Extension bundle privacy check passed.');
    }
  }
}
