import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationsDir = path.resolve('supabase/migrations');
const auditPrefix = '20260921';

test('current telemetry security audit migrations use unique version prefixes', () => {
  const files = fs.readdirSync(migrationsDir)
    .filter((name) => name.startsWith(auditPrefix) && name.endsWith('.sql'))
    .sort();

  assert.ok(files.length >= 11, 'The current telemetry security audit migration set must be present');

  const seen = new Map();
  const duplicates = [];

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    assert.ok(match, `Migration ${file} must begin with a numeric version prefix`);
    const version = match[1];
    const previous = seen.get(version);
    if (previous) duplicates.push(`${version}: ${previous}, ${file}`);
    else seen.set(version, file);
  }

  assert.deepEqual(duplicates, [], `Duplicate audit migration versions found:\n${duplicates.join('\n')}`);
});
