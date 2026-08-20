import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync(new URL('../../components/features/TelemetryEnrollmentWindowControl.tsx', import.meta.url), 'utf8');
const deviceManagement = fs.readFileSync(new URL('../../components/features/AdminTelemetryDevices.tsx', import.meta.url), 'utf8');
const enrollFunction = fs.readFileSync(new URL('../../supabase/functions/telemetry-enroll/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260820130633_telemetry_zero_touch_enrollment_windows.sql', import.meta.url), 'utf8');

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
