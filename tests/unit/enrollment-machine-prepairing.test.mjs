import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260922101500_add_enrollment_machine_prepairing.sql', import.meta.url), 'utf8');
const fkHardening = fs.readFileSync(new URL('../../supabase/migrations/20260922101600_harden_enrollment_machine_target_fk.sql', import.meta.url), 'utf8');
const control = fs.readFileSync(new URL('../../components/features/BulkTelemetryEnrollmentControl.tsx', import.meta.url), 'utf8');

test('bulk enrollment can resolve one exact machine inside the selected region', () => {
  assert.match(migration, /expected_machine_id uuid/);
  assert.match(migration, /m\.telemetry_region = v_region/);
  assert.match(migration, /m\.id::text = v_machine_key_norm/);
  assert.match(migration, /serial_number/);
  assert.match(migration, /asset_tag/);
  assert.match(migration, /machine_barcode/);
  assert.match(migration, /does not exactly match a machine in the selected telemetry region/);
  assert.match(migration, /is ambiguous in the selected telemetry region/);
});

test('machine pre-pairing rejects duplicate, occupied, and competing targets', () => {
  assert.match(migration, /v_seen_machine_ids/);
  assert.match(migration, /targeted more than once in this batch/);
  assert.match(migration, /already has an active telemetry controller/);
  assert.match(migration, /active commissioning token for another controller/);
  assert.match(migration, /for update/);
});

test('a preassigned token wins over reported serial and produces an explicit link method', () => {
  const preassigned = migration.indexOf('if v_token.expected_machine_id is not null then');
  const serialFallback = migration.indexOf("elsif v_serial <> '' then");
  assert.ok(preassigned >= 0, 'expected preassigned-machine branch');
  assert.ok(serialFallback > preassigned, 'serial matching must only be a fallback after token pre-pairing');
  assert.match(migration, /v_site_id := v_expected_machine\.site_id/);
  assert.match(migration, /v_link_status := 'linked'/);
  assert.match(migration, /v_link_method := 'token_preassigned'/);
  assert.match(migration, /'machine_link_method',v_link_method/);
});

test('machine target cannot disappear silently while a commissioning token references it', () => {
  assert.match(fkHardening, /foreign key \(expected_machine_id\)/);
  assert.match(fkHardening, /references public\.machines\(id\)/);
  assert.match(fkHardening, /on delete restrict/);
});

test('device enrollment remains service-role only while operator issuance stays authenticated', () => {
  assert.match(migration, /revoke all on function public\.enroll_telemetry_device\(text,text,text,text,text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.enroll_telemetry_device\(text,text,text,text,text\) to service_role/);
  assert.match(migration, /require_app_role\(array\['admin','operations'\]\)/);
  assert.match(migration, /grant execute on function public\.create_telemetry_enrollment_tokens_bulk\(jsonb,integer,text\) to authenticated/);
});

test('bulk enrollment UI accepts and exports optional machine targets', () => {
  assert.match(control, /machine_key/);
  assert.match(control, /expected_machine_id/);
  assert.match(control, /machine UUID, serial number, asset tag or QR\/barcode/);
  assert.match(control, /hardware_uid,label,machine_key/);
  assert.match(control, /FA\/1938\/VM/);
  assert.match(control, /Supabase did not confirm the machine pre-pair/);
  assert.match(control, /machine_asset_tag/);
  assert.match(control, /machine_barcode/);
});
