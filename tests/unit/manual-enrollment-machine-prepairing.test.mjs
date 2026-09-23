import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260923073000_align_manual_enrollment_machine_prepairing.sql', import.meta.url), 'utf8');
const control = fs.readFileSync(new URL('../../components/features/TelemetryEnrollmentWindowControl.tsx', import.meta.url), 'utf8');

test('manual enrollment keeps four-argument callers compatible while adding an optional machine target', () => {
  assert.match(migration, /drop function if exists public\.create_telemetry_enrollment_token\(text,text,integer,text\)/);
  assert.match(migration, /p_machine_key text default null/);
  assert.match(migration, /create function public\.create_telemetry_enrollment_token/);
});

test('manual token issuance is restricted to active admin or operations users in the selected region', () => {
  assert.match(migration, /assert_telemetry_region_selected\(\)/);
  assert.match(migration, /is_active_app_user\(\)/);
  assert.match(migration, /require_app_role\(array\['admin','operations'\]\)/);
  assert.match(migration, /revoke all on function public\.create_telemetry_enrollment_token\(text,text,integer,text,text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.create_telemetry_enrollment_token\(text,text,integer,text,text\) to authenticated/);
});

test('manual machine targeting uses exact regional identifiers only', () => {
  assert.match(migration, /m\.telemetry_region = v_region/);
  assert.match(migration, /m\.id::text = v_machine_key_norm/);
  assert.match(migration, /serial_number/);
  assert.match(migration, /asset_tag/);
  assert.match(migration, /machine_barcode/);
  assert.match(migration, /does not exactly match a machine in the selected telemetry region/);
  assert.match(migration, /is ambiguous in the selected telemetry region/);
});

test('manual machine pre-pairing rejects occupied or separately reserved machines', () => {
  assert.match(migration, /already has an active telemetry controller/);
  assert.match(migration, /active commissioning token for another controller/);
  assert.match(migration, /for update/);
  assert.match(migration, /expected_machine_id/);
});

test('manual enrollment UI sends and confirms the optional machine target', () => {
  assert.match(control, /manualMachineKey/);
  assert.match(control, /p_machine_key: manualMachineKey\.trim\(\) \|\| null/);
  assert.match(control, /expected_machine_id/);
  assert.match(control, /Supabase did not confirm the intended machine pre-pair/);
  assert.match(control, /Machine UUID, serial, asset tag or QR\/barcode/);
  assert.match(control, /Pre-paired machine:/);
});

test('manual token plaintext remains browser-only', () => {
  assert.match(control, /globalThis\.crypto\.getRandomValues/);
  assert.match(control, /sha256Hex\(token\)/);
  assert.match(control, /p_token_hash: tokenHash/);
  assert.doesNotMatch(migration, /enrollment_token\s+text/i);
});
