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
      if (patterns.some((pattern) => pattern.test(text))) findings.push(relativePath);
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
