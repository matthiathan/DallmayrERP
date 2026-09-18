import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationsDir = path.resolve('supabase/migrations');

test('Supabase migration version prefixes are unique', () => {
  const files = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

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

  assert.deepEqual(duplicates, [], `Duplicate Supabase migration versions found:\n${duplicates.join('\n')}`);
});
