import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDirectory = join(process.cwd(), 'supabase', 'migrations');
const testsDirectory = join(process.cwd(), 'supabase', 'tests');
const migrationNames = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const testNames = readdirSync(testsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const expected = migrationNames.map((_, index) => String(index + 1).padStart(4, '0'));
const actual = migrationNames.map((name) => name.slice(0, 4));

if (migrationNames.length === 0 || actual.some((prefix, index) => prefix !== expected[index])) {
  throw new Error(`Migrations must be contiguous 0001 onward: ${migrationNames.join(', ')}`);
}
if (testNames.length === 0 || migrationNames.some((name) => /test/i.test(name))) {
  throw new Error('SQL tests must exist under supabase/tests and never under supabase/migrations.');
}
console.log(
  `Supabase migration order passed: ${migrationNames.length} migrations, ${testNames.length} SQL test files.`
);
