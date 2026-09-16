import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260916093500_separate_platform_fault_diagnostics.sql', 'utf8');
const panel = fs.readFileSync('components/telemetry-platform/FaultIntelligencePanel.tsx', 'utf8');

test('known telemetry diagnostics live outside manufacturer profile rules', () => {
  assert.match(migration, /create table if not exists public\.telemetry_platform_fault_codes/i);
  assert.match(migration, /'MDB_NO_VALID_TRAFFIC'/i);
  assert.match(migration, /telemetry\/interface visibility, not a manufacturer machine fault code/i);
  assert.match(migration, /telemetry platform diagnostics cannot be promoted as machine-profile fault rules/i);
});

test('fault normalization supports a distinct telemetry diagnostic status', () => {
  assert.match(migration, /telemetry_diagnostic/i);
  assert.match(migration, /create or replace function public\.ingest_telemetry_payload_v7/i);
  assert.match(migration, /select public\.ingest_telemetry_payload_v7\(p_device_id, p_payload\)/i);
  assert.match(migration, /normalization_status = 'telemetry_diagnostic'/i);
});

test('stable V3 remains service-role only after V7 routing', () => {
  assert.match(migration, /revoke all on function public\.ingest_telemetry_payload_v3\(uuid, jsonb\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.ingest_telemetry_payload_v3\(uuid, jsonb\) to service_role/i);
});

test('fault intelligence labels platform diagnostics without offering machine mapping', () => {
  assert.match(panel, /'telemetry_diagnostic'/);
  assert.match(panel, /return 'Telemetry diagnostic'/);
  assert.match(panel, /fault\.normalization_status === 'raw'.*Propose mapping/s);
  assert.match(panel, /Telemetry diagnostics are kept separate/);
});
