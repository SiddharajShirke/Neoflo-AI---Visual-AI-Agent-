import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('contract generation produces the deterministic browser event artifact', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-contracts.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const generated = 'packages/contracts/src/generated/browser-event.ts';
  assert.equal(existsSync(generated), true);
  const contents = readFileSync(generated, 'utf8');
  assert.match(contents, /generated from schemas\/events/);
  assert.match(contents, /events: BrowserEvent\[\];/);

  const controlGenerated = 'packages/contracts/src/generated/control-plane.ts';
  assert.equal(existsSync(controlGenerated), true);
  const controlContents = readFileSync(controlGenerated, 'utf8');
  assert.match(controlContents, /DeviceRegisterRequest/);
  assert.match(controlContents, /isMonitoringSessionCreateResponse/);
});
