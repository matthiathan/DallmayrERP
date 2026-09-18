import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationsDir = path.resolve('supabase/migrations');
const suffix = '_retire_dormant_regional_mutation_rpcs.sql';

function migrationText() {
  const file = fs.readdirSync(migrationsDir).find((name) => name.endsWith(suffix));
  assert.ok(file, 'A dedicated migration must retire dormant regional mutation RPCs');
  return fs.readFileSync(path.join(migrationsDir, file), 'utf8').toLowerCase();
}

const dormantFunctions = [
  'set_customer_site_telemetry_region(uuid, text)',
  'set_device_telemetry_region(uuid, text)',
  'set_telemetry_fleet_attention_workflow(text, uuid, text, text, timestamp with time zone, text)',
];

function escaped(signature) {
  return signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('dormant security-definer regional mutation RPCs are not callable by authenticated clients', () => {
  const sql = migrationText();
  for (const signature of dormantFunctions) {
    assert.match(
      sql,
      new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${escaped(signature)}\\s+from\\s+authenticated`),
      `${signature} must revoke authenticated execution`,
    );
  }
});

test('dormant regional mutation RPCs retain service-role maintenance compatibility', () => {
  const sql = migrationText();
  for (const signature of dormantFunctions) {
    assert.match(
      sql,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped(signature)}\\s+to\\s+service_role`),
      `${signature} must retain service-role execution`,
    );
  }
});
