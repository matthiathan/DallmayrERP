import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20260915133500_telemetry_vend_evidence_reconciliation.sql', import.meta.url),
  'utf8',
);

const recordFunction = migration.match(
  /create or replace function public\.record_telemetry_vend_evidence[\s\S]*?\$function\$;/i,
)?.[0] ?? '';

const profileHelper = migration.match(
  /create or replace function public\.resolve_effective_telemetry_profile_key[\s\S]*?\$function\$;/i,
)?.[0] ?? '';

const v4Function = migration.match(
  /create or replace function public\.ingest_telemetry_payload_v4[\s\S]*?\$function\$;/i,
)?.[0] ?? '';

const v3CompatibilityFunction = migration.match(
  /create or replace function public\.ingest_telemetry_payload_v3\([\s\S]*?language sql[\s\S]*?\$function\$;/i,
)?.[0] ?? '';

test('vend evidence is append-only, idempotent, and isolated from production accounting', () => {
  assert.match(migration, /create table if not exists public\.telemetry_vend_evidence/i);
  assert.match(migration, /unique \(device_id, source, correlation_key, evidence_type\)/i);
  assert.match(migration, /before update or delete on public\.telemetry_vend_evidence/i);
  assert.match(recordFunction, /on conflict \(device_id, source, correlation_key, evidence_type\) do nothing/i);
  assert.match(recordFunction, /'accounting_source', 'counter_snapshot'/i);
  assert.doesNotMatch(recordFunction, /insert into public\.telemetry_daily_item_sales/i);
  assert.doesNotMatch(recordFunction, /update public\.telemetry_daily_item_sales/i);
});

test('vend evidence confidence is capped by the server-side evidence type', () => {
  assert.match(recordFunction, /vend_success', 'vend_failure', 'vend_denied'\) then 100/i);
  assert.match(recordFunction, /v_evidence_type = 'cash_sale' then 95/i);
  assert.match(recordFunction, /v_default_confidence := 80/i);
  assert.match(recordFunction, /v_default_confidence := 85/i);
  assert.match(recordFunction, /least\(\s*v_default_confidence,\s*coalesce\(v_requested_confidence, v_default_confidence\)\s*\)/si);
});

test('V4 adds vend evidence without bypassing selection learn mode or the proven V3 core', () => {
  assert.match(v4Function, /vend_evidence/i);
  assert.match(v4Function, /record_telemetry_vend_evidence/i);
  assert.match(v4Function, /selection_observation/i);
  assert.match(v4Function, /ingest_telemetry_selection_observation_v1/i);
  assert.match(v4Function, /ingest_telemetry_payload_v3_core/i);
  assert.match(v3CompatibilityFunction, /ingest_telemetry_payload_v4/i);
});

test('existing product mapping API delegates profile choice to the unified machine identity scorer', () => {
  assert.match(
    profileHelper,
    /resolve_effective_telemetry_profile_key\(\s*p_device_id uuid,\s*p_machine_id uuid\s*\)/si,
  );
  assert.match(profileHelper, /resolve_telemetry_device_profile\(v_device_id\)/i);
  assert.match(profileHelper, /effective_profile_key/i);
  assert.doesNotMatch(migration, /drop function public\.resolve_mapped_product_name/i);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.resolve_mapped_product_name/i,
  );
  assert.match(
    recordFunction,
    /resolve_mapped_product_name\(\s*v_device\.machine_id,\s*p_device_id,\s*v_selection\s*\)/si,
  );
});

test('reconciliation deduplicates correlated completion signals and compares them with counter-accounted sales', () => {
  assert.match(migration, /get_telemetry_vend_reconciliation/i);
  assert.match(migration, /e\.correlation_key/i);
  assert.match(migration, /max\(e\.quantity\) filter/i);
  assert.match(migration, /from public\.telemetry_vend_evidence e/i);
  assert.match(migration, /from public\.telemetry_daily_item_sales s/i);
  assert.match(migration, /matched_mdb_counter/i);
  assert.match(migration, /matched_dex_counter/i);
  assert.match(migration, /evidence_conflict/i);
  assert.match(migration, /mdb_evidence_ahead/i);
  assert.match(migration, /dex_evidence_ahead/i);
  assert.match(migration, /counter_only/i);
  assert.match(migration, /evidence_only/i);
});
