import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanDirectory } from './secret-scan.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'visual-ai-secret-scan-'));
  return {
    root,
    write(path, contents) {
      const target = join(root, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, contents);
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test('detects a fake secret in a source file', () => {
  const tree = fixture();
  try {
    tree.write('apps/api/source.py', `api${'_'}key="${'x'.repeat(16)}"`);
    assert.deepEqual(scanDirectory(tree.root), ['apps/api/source.py']);
  } finally {
    tree.dispose();
  }
});

test('ignores generated runtime and dependency files', () => {
  const tree = fixture();
  try {
    for (const directory of [
      '.python',
      '.venv',
      '.uv-cache',
      'node_modules',
      '.next',
      'dist',
      'build'
    ]) {
      tree.write(`${directory}/generated.bin`, `api${'_'}key="${'x'.repeat(16)}"`);
    }
    assert.deepEqual(scanDirectory(tree.root), []);
  } finally {
    tree.dispose();
  }
});

test('scans environment examples', () => {
  const tree = fixture();
  try {
    tree.write('apps/api/.env.example', `secret="${'x'.repeat(16)}"`);
    assert.deepEqual(scanDirectory(tree.root), ['apps/api/.env.example']);
  } finally {
    tree.dispose();
  }
});

test('keeps real environment files ignored by Git', () => {
  const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');

  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  execFileSync('git', ['check-ignore', '--quiet', '--no-index', '.env']);
  assert.throws(() => {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', '.env.example']);
  });
});
