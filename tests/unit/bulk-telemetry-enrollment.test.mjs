import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260922094000_add_bulk_telemetry_enrollment_tokens.sql', import.meta.url), 'utf8');
const control = fs.readFileSync(new URL('../../components/features/BulkTelemetryEnrollmentControl.tsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../app/telemetry/devices/page.tsx', import.meta.url), 'utf8');

test('bulk enrollment is region-scoped and restricted to privileged operational roles', () => {
  assert.match(migration, /assert_telemetry_region_selected\(\)/);
  assert.match(migration, /require_app_role\(array\['admin','operations'\]\)/);
  assert.match(migration, /telemetry_region/);
  assert.match(migration, /created_by_auth_user_id/);
  assert.match(migration, /from public, anon/);
  assert.match(migration, /to authenticated/);
});

test('bulk enrollment is exact-UID, bounded and one-time-token based', () => {
  assert.match(migration, /v_count < 1 or v_count > 500/);
  assert.match(migration, /'\^\[0-9A-F\]\{12\}\$'/);
  assert.match(migration, /'\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /already enrolled/);
  assert.match(migration, /appears more than once in this batch/);
  assert.match(migration, /set revoked_at = now\(\)/);
  assert.match(migration, /expected_hardware_uid/);
  assert.doesNotMatch(migration, /token\s+text/i);
});

test('plaintext enrollment secrets stay in the browser and can be exported for commissioning', () => {
  assert.match(control, /crypto\.getRandomValues/);
  assert.match(control, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(control, /create_telemetry_enrollment_tokens_bulk/);
  assert.match(control, /token_hash/);
  assert.match(control, /Export commissioning CSV/);
  assert.match(control, /ENROLL TOKEN/);
  assert.match(control, /max 500/);
  assert.match(control, /Administrator and Operations/);
  assert.match(page, /BulkTelemetryEnrollmentControl/);
  assert.match(page, /<BulkTelemetryEnrollmentControl \/>/);
});
