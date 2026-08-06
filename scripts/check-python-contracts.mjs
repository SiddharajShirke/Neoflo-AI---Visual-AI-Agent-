import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const python =
  process.platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'python.exe')
    : join(root, '.venv', 'bin', 'python');

if (!existsSync(python)) {
  throw new Error(`Repository virtual environment is required: ${python}`);
}

const result = spawnSync(python, ['-m', 'pytest', 'apps/api/tests/test_event_contract.py', '-q'], {
  cwd: root,
  stdio: 'inherit'
});
if (result.status !== 0) process.exit(result.status ?? 1);
