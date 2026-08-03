import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set([
  '.git',
  'node_modules',
  '.next',
  '.wxt',
  'dist',
  '.venv',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.superpowers',
  '__pycache__',
  'coverage'
]);
const syntheticFixturePaths = new Set(['tests/test_validate_skills.py']);
const patterns = [
  /(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}/i,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10}/
];
const findings = [];

function visit(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      visit(path);
      continue;
    }
    const relativePath = relative(root, path).replaceAll('\\', '/');
    if (
      entry === '.env.example' ||
      entry.endsWith('.gitkeep') ||
      syntheticFixturePaths.has(relativePath)
    ) {
      continue;
    }
    const text = readFileSync(path, 'utf8');
    if (patterns.some((pattern) => pattern.test(text))) findings.push(relativePath);
  }
}

visit(root);
if (findings.length > 0) {
  console.error(`Potential secrets found in: ${findings.join(', ')}`);
  process.exit(1);
}
console.log('Secret scan passed: no suspicious tracked-file values found.');
