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

test('does not treat the Phoenix access-token protocol key map as a secret', () => {
  const tree = fixture();
  try {
    tree.write('apps/extension/.output/chrome-mv3/background.js', 'access_token:"access_token"');
    assert.deepEqual(scanDirectory(tree.root), []);
  } finally {
    tree.dispose();
  }
});

test('does not treat the Supabase Realtime authentication warning as a secret', () => {
  const tree = fixture();
  try {
    tree.write(
      'apps/extension/.output/chrome-mv3/background.js',
      'console.warn("Failed to set initial Realtime auth token:",h)),this.rest=new Hs(new URL('
    );
    assert.deepEqual(scanDirectory(tree.root), []);
  } finally {
    tree.dispose();
  }
});

test('still detects real secret patterns adjacent to the Supabase Realtime warning', () => {
  const tree = fixture();
  try {
    const tokenLabel = ['to', 'ken'].join('');
    const warning = `console.warn("Failed to set initial Realtime auth ${tokenLabel}:",h),"rest/v1",i).href; `;
    tree.write('apps/extension/.output/chrome-mv3/sk.js', `${warning}sk_${'x'.repeat(20)}`);
    tree.write(
      'apps/extension/.output/chrome-mv3/jwt.js',
      `${warning}eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`
    );
    tree.write(
      'apps/extension/.output/chrome-mv3/api-key.js',
      `${warning}api_key="${'x'.repeat(16)}"`
    );
    assert.deepEqual(scanDirectory(tree.root), [
      'apps/extension/.output/chrome-mv3/api-key.js',
      'apps/extension/.output/chrome-mv3/jwt.js',
      'apps/extension/.output/chrome-mv3/sk.js'
    ]);
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
