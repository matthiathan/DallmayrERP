import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));
const controls = fs.readFileSync(new URL('../../components/features/MachineCreateImportControls.tsx', import.meta.url), 'utf8');

test('machine creation and bulk import derive the selected telemetry region server-side', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_region_safe_machine_onboarding.sql'));
  assert.ok(migration, 'A dedicated region-safe machine onboarding migration must exist');
  const sql = migration.content;

  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.create_telemetry_machine\s*\(/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.import_telemetry_machines\s*\(/i);
  assert.doesNotMatch(sql, /security\s+definer/i, 'onboarding RPCs must not add another authenticated SECURITY DEFINER surface');
  assert.match(sql, /security\s+invoker/gi);
  assert.match(sql, /assert_telemetry_region_selected\s*\(\s*\)/i);
  assert.match(sql, /require_app_role\s*\(\s*array\s*\[[^\]]*admin[^\]]*operations[^\]]*technician[^\]]*road_technician/i);
  assert.match(sql, /telemetry_region\s*\)\s*select[\s\S]*v_region/i);
  assert.match(sql, /customer_sites[\s\S]*customer_id[\s\S]*telemetry_region\s*=\s*v_region/i);
  assert.match(sql, /5000/);
  assert.match(sql, /jsonb_array_elements\s*\(/i);
  assert.match(sql, /serial_number/i);
  assert.match(sql, /machine_barcode/i);
  assert.match(sql, /duplicate/i);
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.create_telemetry_machine[\s\S]*from\s+public\s*,\s*anon/i);
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.import_telemetry_machines[\s\S]*from\s+public\s*,\s*anon/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.create_telemetry_machine[\s\S]*to\s+authenticated/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.import_telemetry_machines[\s\S]*to\s+authenticated/i);
});

test('machine onboarding UI uses region-safe RPCs instead of direct machine inserts', () => {
  assert.match(controls, /rpc\('create_telemetry_machine'/);
  assert.match(controls, /rpc\('import_telemetry_machines'/);
  assert.doesNotMatch(controls, /from\('machines'\)\.insert\(/);
  assert.match(controls, /current_telemetry_region/);
  assert.match(controls, /Import target/i);
  assert.match(controls, /MAX_IMPORT_ROWS\s*=\s*5000/);
  assert.match(controls, /dallmayr-machine-import-errors\.csv/);
});
