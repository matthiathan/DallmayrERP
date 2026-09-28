import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsUrl), 'utf8'))
  .join('\n');
const ingest = fs.readFileSync(new URL('../../supabase/functions/telemetry-ingest/index.ts', import.meta.url), 'utf8');
const deviceManagement = fs.readFileSync(new URL('../../components/features/AdminTelemetryDevices.tsx', import.meta.url), 'utf8');

test('current telemetry records authoritative successful transport time and exposes per-network usage', () => {
  assert.match(ingest, /patch\.last_transport\s*=\s*transport/);
  assert.match(ingest, /patch\.last_transport_at\s*=\s*new Date\(\)\.toISOString\(\)/);
  assert.match(migrations, /add column if not exists last_transport_at timestamptz/i);
  assert.match(migrations, /create or replace function public\.get_telemetry_transport_usage\s*\(/i);
  assert.match(migrations, /group by\s+u\.device_id\s*,\s*u\.transport/i);
  assert.match(deviceManagement, /get_telemetry_transport_usage/);
  assert.match(deviceManagement, /Wi-Fi · last 30 days/);
  assert.match(deviceManagement, /Cellular · last 30 days/);
});
