import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync(new URL('../../components/features/TelemetryEnrollmentWindowControl.tsx', import.meta.url), 'utf8');
const deviceManagement = fs.readFileSync(new URL('../../components/features/AdminTelemetryDevices.tsx', import.meta.url), 'utf8');
const enrollFunction = fs.readFileSync(new URL('../../supabase/functions/telemetry-enroll/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260820130633_telemetry_zero_touch_enrollment_windows.sql', import.meta.url), 'utf8');
const manualTokenMigration = fs.readFileSync(new URL('../../supabase/migrations/20260824132238_telemetry_uid_bound_manual_enrollment_tokens.sql', import.meta.url), 'utf8');

test('administrators can open one short-lived enrollment window from device management', () => {
  assert.match(component, /open_telemetry_enrollment_window/);
  assert.match(component, /p_minutes: 10/);
  assert.match(component, /p_max_devices: 1/);
  assert.match(component, /Allow next device/);
  assert.match(component, /get_telemetry_enrollment_window_status/);
  assert.match(component, /close_telemetry_enrollment_window/);
  assert.match(deviceManagement, /<TelemetryEnrollmentWindowControl onDeviceEnrolled=\{loadDevices\}/);
});

test('automatic enrollment remains server-authorized and atomically limited', () => {
  assert.match(migration, /public\.current_app_role\(\) <> 'admin'/);
  assert.match(migration, /create unique index if not exists telemetry_enrollment_one_open_window_idx/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /claimed_count = claimed_count \+ 1/);
  assert.match(migration, /grant execute on function public\.enroll_telemetry_device_zero_touch[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.enroll_telemetry_device_zero_touch[\s\S]*from public, anon, authenticated/);
});

test('enrollment keeps one-time token compatibility and uses a window when the token is absent', () => {
  assert.match(enrollFunction, /const enrollment = enrollmentToken/);
  assert.match(enrollFunction, /enroll_telemetry_device'/);
  assert.match(enrollFunction, /enroll_telemetry_device_zero_touch'/);
  assert.match(enrollFunction, /enrollment_method: enrollmentToken/);
});

test('administrators can generate and copy a one-time token without sending its plaintext to Supabase', () => {
  assert.match(component, /globalThis\.crypto\.getRandomValues/);
  assert.match(component, /globalThis\.crypto\.subtle\.digest\('SHA-256'/);
  assert.match(component, /create_telemetry_enrollment_token/);
  assert.match(component, /p_token_hash: tokenHash/);
  assert.doesNotMatch(component, /p_token:\s*token/);
  assert.match(component, /ENROLL TOKEN \{manualToken\.token\}/);
  assert.match(component, /navigator\.clipboard\.writeText\(`ENROLL TOKEN \$\{manualToken\.token\}`\)/);
  assert.match(component, /Generate one-time token/);
  assert.match(component, /Revoke token/);
  assert.match(component, /get_telemetry_enrollment_token_status/);
});

test('manual tokens are short-lived, single-use, administrator-issued, and bound to one hardware UID', () => {
  assert.match(manualTokenMigration, /add column if not exists expected_hardware_uid text/);
  assert.match(manualTokenMigration, /add column if not exists revoked_at timestamptz/);
  assert.match(manualTokenMigration, /coalesce\(public\.current_app_role\(\), ''\) <> 'admin'/);
  assert.match(manualTokenMigration, /v_hardware_uid !~ '\^\[0-9A-F\]\{12\}\$'/);
  assert.match(manualTokenMigration, /v_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(manualTokenMigration, /pg_advisory_xact_lock\(hashtextextended\(v_hardware_uid, 0\)\)/);
  assert.match(manualTokenMigration, /set revoked_at = now\(\)[\s\S]*expected_hardware_uid = v_hardware_uid/);
  assert.match(manualTokenMigration, /now\(\) \+ make_interval\(mins => p_minutes\)/);
  assert.match(manualTokenMigration, /v_token\.expected_hardware_uid is distinct from v_hardware_uid/);
  assert.match(manualTokenMigration, /v_token\.used_at is not null/);
  assert.match(manualTokenMigration, /v_token\.revoked_at is not null/);
  assert.match(manualTokenMigration, /for update/);
  assert.match(manualTokenMigration, /grant execute on function public\.create_telemetry_enrollment_token[\s\S]*to authenticated/);
  assert.match(manualTokenMigration, /revoke all on function public\.enroll_telemetry_device[\s\S]*from public, anon, authenticated/);
});
