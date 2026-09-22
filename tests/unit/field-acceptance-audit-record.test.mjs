import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));

const page = fs.readFileSync(new URL('../../app/telemetry/test-center/page.tsx', import.meta.url), 'utf8');
const panelPath = new URL('../../components/features/TelemetryFieldAcceptanceRecord.tsx', import.meta.url);

test('field acceptance creates immutable region-scoped audit records from authoritative telemetry evidence', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_add_field_acceptance_audit_records.sql'));
  assert.ok(migration, 'A dedicated field-acceptance audit migration must exist');

  const sql = migration.content;
  assert.match(sql, /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.telemetry_field_acceptance_records/i);
  assert.match(sql, /test_session_id\s+uuid\s+not\s+null/i);
  assert.match(sql, /unique\s*\(\s*test_session_id\s*\)|unique\s+index[\s\S]*test_session_id/i);
  assert.match(sql, /evidence_snapshot\s+jsonb\s+not\s+null/i);
  assert.match(sql, /expected_plan\s+jsonb\s+not\s+null/i);
  assert.match(sql, /telemetry_region\s+text\s+not\s+null/i);
  assert.match(sql, /enable\s+row\s+level\s+security/i);
  assert.match(sql, /revoke[\s\S]*insert[\s\S]*update[\s\S]*delete[\s\S]*authenticated/i);
  assert.match(sql, /current_telemetry_region\s*\(\s*\)/i);

  const finalize = sql.match(/create\s+or\s+replace\s+function\s+public\.finalize_telemetry_field_acceptance\s*\([\s\S]*?(?=revoke\s+all|grant\s+execute|comment\s+on|$)/i)?.[0] ?? '';
  assert.ok(finalize, 'finalize_telemetry_field_acceptance must exist');
  assert.match(finalize, /assert_telemetry_region_selected\s*\(\s*\)/i);
  assert.match(finalize, /is_active_app_user\s*\(\s*\)/i);
  assert.match(finalize, /require_app_role\s*\(\s*array\s*\[[^\]]*(admin|operations|technician|road_technician)/i);
  assert.match(finalize, /telemetry_test_sessions/i);
  assert.match(finalize, /telemetry_debug_logs/i);
  assert.match(finalize, /telemetry_vend_evidence/i);
  assert.match(finalize, /reported_machine_interface/i);
  assert.match(finalize, /last_transport/i);
  assert.match(finalize, /applied_config/i);
  assert.doesNotMatch(finalize, /p_evidence_snapshot/i, 'the browser must not provide the authoritative evidence snapshot');
});

test('Test Center exposes a durable acceptance-record workflow with the controlled vend plan', () => {
  assert.equal(fs.existsSync(panelPath), true, 'TelemetryFieldAcceptanceRecord component must exist');
  const panel = fs.readFileSync(panelPath, 'utf8');

  assert.match(page, /TelemetryFieldAcceptanceRecord/);
  assert.match(panel, /finalize_telemetry_field_acceptance/);
  assert.match(panel, /telemetry_field_acceptance_records/);
  assert.match(panel, /Instant Porridge/);
  assert.match(panel, /Caramel Cappuccino/);
  assert.match(panel, /Known mapped product/);
  assert.match(panel, /free, failed or cancelled/i);
  assert.match(panel, /Passed/);
  assert.match(panel, /Failed/);
  assert.match(panel, /Evidence snapshot/);
});
