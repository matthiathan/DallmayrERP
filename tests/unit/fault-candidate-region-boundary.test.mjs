import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));

function functionBlock(sql, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\s*\\([\\s\\S]*?(?=create\\s+or\\s+replace\\s+function\\s+public\\.|drop\\s+policy|create\\s+policy|revoke\\s+all|grant\\s+execute|comment\\s+on|$)`, 'i'))?.[0] ?? '';
}

test('fault candidate reads are restricted to the selected telemetry region', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_harden_fault_candidate_region_boundaries.sql'));
  assert.ok(migration, 'A dedicated fault candidate region-boundary migration must exist');

  assert.match(migration.content, /create\s+policy\s+telemetry_region_scope_fault_rule_candidates[\s\S]*?on\s+public\.telemetry_fault_rule_candidates[\s\S]*?as\s+restrictive[\s\S]*?to\s+authenticated/i);
  assert.match(migration.content, /using\s*\(\s*public\.telemetry_region_allows_device\s*\(\s*device_id\s*\)\s*\)/i);
  assert.match(migration.content, /with\s+check\s*\(\s*public\.telemetry_region_allows_device\s*\(\s*device_id\s*\)\s*\)/i);
});

test('fault candidate Security Definer mutations enforce the selected telemetry region', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_harden_fault_candidate_region_boundaries.sql'));
  assert.ok(migration);

  for (const functionName of ['submit_telemetry_fault_rule_candidate_v1', 'review_telemetry_fault_rule_candidate_v1']) {
    const body = functionBlock(migration.content, functionName);
    assert.ok(body, `${functionName} must be redefined`);
    assert.match(body, /assert_telemetry_region_selected\s*\(\s*\)/i, `${functionName} must require a selected telemetry region`);
    assert.match(body, /telemetry_region_allows_device\s*\(/i, `${functionName} must verify the fault/candidate device belongs to that region`);
  }
});

test('fault candidate RPC execution remains authenticated-only', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_harden_fault_candidate_region_boundaries.sql'));
  assert.ok(migration);

  assert.match(migration.content, /revoke\s+all\s+on\s+function\s+public\.submit_telemetry_fault_rule_candidate_v1\(uuid,\s*text,\s*text,\s*text,\s*text,\s*text,\s*text,\s*text\)\s+from\s+public,\s*anon/i);
  assert.match(migration.content, /grant\s+execute\s+on\s+function\s+public\.submit_telemetry_fault_rule_candidate_v1\(uuid,\s*text,\s*text,\s*text,\s*text,\s*text,\s*text,\s*text\)\s+to\s+authenticated,\s*service_role/i);
  assert.match(migration.content, /revoke\s+all\s+on\s+function\s+public\.review_telemetry_fault_rule_candidate_v1\(uuid,\s*text,\s*text\)\s+from\s+public,\s*anon/i);
  assert.match(migration.content, /grant\s+execute\s+on\s+function\s+public\.review_telemetry_fault_rule_candidate_v1\(uuid,\s*text,\s*text\)\s+to\s+authenticated,\s*service_role/i);
});
