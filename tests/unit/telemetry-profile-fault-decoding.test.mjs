import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260916090500_profile_driven_fault_decoding.sql', 'utf8');

test('fault catalogue is profile-specific and requires verified rules', () => {
  assert.match(migration, /create table if not exists public\.machine_model_fault_rules/i);
  assert.match(migration, /profile_id uuid not null references public\.machine_model_profiles/i);
  assert.match(migration, /is_verified boolean not null default false/i);
  assert.match(migration, /r\.is_verified/i);
  assert.match(migration, /r\.is_active/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.machine_model_fault_rules/i,
    'manufacturer fault meanings must not be guessed or seeded by this migration');
});

test('raw machine fault code remains authoritative evidence', () => {
  assert.match(migration, /fault_code text/i);
  assert.match(migration, /Raw fault code received from the telemetry device\. Never replaced by normalized codes/i);
  assert.match(migration, /canonical_fault_code/i);
  assert.match(migration, /normalization_status/i);
});

test('verified severity is applied before existing fault-state accounting runs', () => {
  const rulePosition = migration.indexOf('resolve_telemetry_fault_rule_v1');
  const severityPosition = migration.indexOf("jsonb_set(v_payload, '{severity}'");
  const delegatePosition = migration.indexOf('ingest_telemetry_payload_v5(p_device_id, v_payload)');
  assert.ok(rulePosition >= 0 && severityPosition > rulePosition && delegatePosition > severityPosition);
});

test('unknown faults remain raw and still pass through proven V5 ingestion', () => {
  assert.match(migration, /'matched', false, 'status', 'raw'/i);
  assert.match(migration, /if v_type <> 'fault_state' then\s+return public\.ingest_telemetry_payload_v5/i);
  assert.match(migration, /coalesce\(v_rule ->> 'status', 'raw'\)/i);
});

test('stable V3 ingest endpoint routes through V6 and remains service-role only', () => {
  assert.match(migration, /create or replace function public\.ingest_telemetry_payload_v6/i);
  assert.match(migration, /select public\.ingest_telemetry_payload_v6\(p_device_id, p_payload\)/i);
  assert.match(migration, /revoke all on function public\.ingest_telemetry_payload_v6\(uuid, jsonb\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.ingest_telemetry_payload_v6\(uuid, jsonb\) to service_role/i);
});

test('fault rule table blocks anonymous access and exposes only read access to authenticated app users', () => {
  assert.match(migration, /alter table public\.machine_model_fault_rules enable row level security/i);
  assert.match(migration, /revoke all on table public\.machine_model_fault_rules from anon/i);
  assert.match(migration, /grant select on table public\.machine_model_fault_rules to authenticated/i);
  assert.match(migration, /using \(public\.is_active_app_user\(\)\)/i);
});
