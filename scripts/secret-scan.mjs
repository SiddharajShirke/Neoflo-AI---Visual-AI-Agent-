import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.mypy_cache',
  '.pytest_cache',
  '.python',
  '.ruff_cache',
  '.superpowers',
  '.uv-cache',
  '.venv',
  '.wxt',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules'
]);

const patterns = [
  /(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}/i,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10}/
];

function isPhoenixAccessTokenKeyMap(text, match) {
  const prefixLength = 'access_'.length;
  const start = Math.max(0, match.index - prefixLength);
  const end = Math.min(text.length, match.index + match[0].length + 1);
  return /^access_token\s*:\s*['"]access_token['"]$/i.test(text.slice(start, end));
}

function isSupabaseRealtimeAuthWarning(text, match) {
  const staticSpan = 'Failed to set initial Realtime auth token:",h)),this.rest=new Hs(new URL(';
  const start = text.lastIndexOf(staticSpan, match.index);
  return start !== -1 && start + staticSpan.length === match.index + match[0].length;
}

function hasSuspiciousValue(text) {
  return patterns.some((pattern) =>
    Array.from(text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))).some(
      (match) =>
        !isPhoenixAccessTokenKeyMap(text, match) && !isSupabaseRealtimeAuthWarning(text, match)
    )
  );
}

export function scanDirectory(root) {
  const findings = [];

  function visit(directory) {
    for (const entry of readdirSync(directory)) {
      if (ignoredDirectories.has(entry)) continue;
      const path = resolve(directory, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
        continue;
      }
      const relativePath = relative(root, path).replaceAll('\\', '/');
      if (entry.endsWith('.gitkeep')) continue;
      const text = readFileSync(path, 'utf8');
      if (hasSuspiciousValue(text)) findings.push(relativePath);
    }
  }

  visit(root);
  return findings.sort();
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const findings = scanDirectory(process.cwd());
  if (findings.length > 0) {
    console.error(`Potential secrets found in: ${findings.join(', ')}`);
    process.exit(1);
  }
  console.log('Secret scan passed: no suspicious tracked-file values found.');
}
