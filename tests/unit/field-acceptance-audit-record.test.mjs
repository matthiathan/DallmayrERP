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
  assert.match(sql, /revoke\s+all\s+on\s+public\.telemetry_field_acceptance_records\s+from\s+anon\s*,?\s*authenticated/i);
  assert.match(sql, /grant\s+select\s+on\s+public\.telemetry_field_acceptance_records\s+to\s+authenticated/i);
  assert.match(sql, /grant\s+insert\s*\(\s*test_session_id\s*,\s*outcome\s*,\s*operator_notes\s*\)\s+on\s+public\.telemetry_field_acceptance_records\s+to\s+authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)(?:\s*,|\s+on)\s+public\.telemetry_field_acceptance_records\s+to\s+authenticated/i);
  assert.match(sql, /current_telemetry_region\s*\(\s*\)/i);

  const prepare = sql.match(/create\s+or\s+replace\s+function\s+public\.prepare_telemetry_field_acceptance_record\s*\(\s*\)[\s\S]*?(?=create\s+trigger|drop\s+trigger|create\s+or\s+replace\s+function\s+public\.finalize_telemetry_field_acceptance|$)/i)?.[0] ?? '';
  assert.ok(prepare, 'prepare_telemetry_field_acceptance_record trigger function must exist');
  assert.match(prepare, /security\s+definer/i);
  assert.match(prepare, /assert_telemetry_region_selected\s*\(\s*\)/i);
  assert.match(prepare, /is_active_app_user\s*\(\s*\)/i);
  assert.match(prepare, /require_app_role\s*\(\s*array\s*\[[^\]]*(admin|operations|technician|road_technician)/i);
  assert.match(prepare, /telemetry_test_sessions/i);
  assert.match(prepare, /telemetry_debug_logs/i);
  assert.match(prepare, /telemetry_vend_evidence/i);
  assert.match(prepare, /reported_machine_interface/i);
  assert.match(prepare, /last_transport/i);
  assert.match(prepare, /applied_config/i);
  assert.match(sql, /before\s+insert\s+on\s+public\.telemetry_field_acceptance_records/i);
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.prepare_telemetry_field_acceptance_record\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);

  const finalize = sql.match(/create\s+or\s+replace\s+function\s+public\.finalize_telemetry_field_acceptance\s*\([\s\S]*?(?=revoke\s+all|grant\s+execute|comment\s+on|$)/i)?.[0] ?? '';
  assert.ok(finalize, 'finalize_telemetry_field_acceptance must exist');
  assert.match(finalize, /security\s+invoker/i);
  assert.doesNotMatch(finalize, /p_evidence_snapshot/i, 'the browser must not provide the authoritative evidence snapshot');
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.finalize_telemetry_field_acceptance[\s\S]*from\s+public\s*,\s*anon/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.finalize_telemetry_field_acceptance[\s\S]*to\s+authenticated/i);
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
