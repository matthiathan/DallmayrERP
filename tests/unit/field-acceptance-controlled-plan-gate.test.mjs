import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));
const panel = fs.readFileSync(new URL('../../components/features/TelemetryFieldAcceptanceRecord.tsx', import.meta.url), 'utf8');

test('field acceptance snapshots a baseline and proves the controlled vend sequence', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_harden_controlled_field_acceptance_gate.sql'));
  assert.ok(migration, 'controlled field-acceptance hardening migration must exist');
  const sql = migration.content;

  assert.match(sql, /acceptance_baseline\s+jsonb/i);
  assert.match(sql, /start_telemetry_test_session/i);
  assert.match(sql, /Instant Porridge/i);
  assert.match(sql, /Caramel Cappuccino/i);
  assert.match(sql, /controlled_plan_reconciled/i);
  assert.match(sql, /negative_or_free_scenario/i);
  assert.match(sql, /machine_linked/i);
  assert.match(sql, /configuration_applied/i);
  assert.match(sql, /data_usage_evidence/i);
  assert.match(sql, /reporting_reconciled/i);
  assert.match(sql, /daily_delta_units/i);
  assert.match(sql, /monthly_delta_units/i);
  assert.match(sql, /cellular_bytes_delta/i);
  assert.match(sql, /v_pass_ready[\s\S]*controlled_plan_reconciled/i);
  assert.match(sql, /v_pass_ready[\s\S]*data_usage_evidence/i);
  assert.match(sql, /v_pass_ready[\s\S]*reporting_reconciled/i);
});

test('field acceptance UI exposes the hardened reconciliation snapshot', () => {
  assert.match(panel, /Controlled plan reconciliation/);
  assert.match(panel, /Reporting reconciliation/);
  assert.match(panel, /Cellular data delta/);
  assert.match(panel, /Machine linked/);
  assert.match(panel, /Configuration applied/);
});
