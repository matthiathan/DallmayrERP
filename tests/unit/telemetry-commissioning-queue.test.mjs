import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260923074500_add_telemetry_commissioning_queue.sql', import.meta.url), 'utf8');
const queue = fs.readFileSync(new URL('../../components/features/TelemetryCommissioningQueue.tsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../app/telemetry/devices/page.tsx', import.meta.url), 'utf8');

test('commissioning queue exposes safe regional metadata through an authorized RPC', () => {
  assert.match(migration, /get_telemetry_commissioning_queue/);
  assert.match(migration, /assert_telemetry_region_selected\(\)/);
  assert.match(migration, /is_active_app_user\(\)/);
  assert.match(migration, /require_app_role\(array\['admin','operations'\]\)/);
  assert.match(migration, /t\.telemetry_region = v_region/);
  assert.match(migration, /revoke all on function public\.get_telemetry_commissioning_queue\(text,integer\) from public, anon/);
  assert.match(migration, /grant execute on function public\.get_telemetry_commissioning_queue\(text,integer\) to authenticated/);
  assert.doesNotMatch(migration, /select[\s\S]{0,100}token_hash/i);
});

test('commissioning state distinguishes waiting, enrollment health, attention and history', () => {
  assert.match(migration, /'waiting'/);
  assert.match(migration, /'online'/);
  assert.match(migration, /'enrolled_offline'/);
  assert.match(migration, /'attention'/);
  assert.match(migration, /'expired'/);
  assert.match(migration, /'revoked'/);
  assert.match(migration, /used_by_device_id is null/);
  assert.match(migration, /d\.machine_id is distinct from t\.expected_machine_id/);
  assert.match(migration, /interval '30 minutes'/);
});

test('commissioning queue joins intended machine and resulting device without exposing credentials', () => {
  assert.match(migration, /left join public\.machines/);
  assert.match(migration, /left join public\.telemetry_devices/);
  assert.match(migration, /machine_asset_tag/);
  assert.match(migration, /machine_barcode/);
  assert.match(migration, /device_machine_link_method/);
  assert.match(migration, /last_seen_at/);
  assert.match(migration, /last_transport/);
});

test('commissioning panel is present in the telemetry devices workspace', () => {
  assert.match(page, /TelemetryCommissioningQueue/);
  assert.match(page, /<TelemetryCommissioningQueue \/>/);
  assert.match(queue, /data-telemetry-commissioning-queue="v1"/);
  assert.match(queue, /get_telemetry_commissioning_queue/);
  assert.match(queue, /p_limit: 500/);
  assert.match(queue, /enrollment-token hashes are never returned to the browser/);
  assert.match(queue, /Device or machine-link mismatch/);
});
