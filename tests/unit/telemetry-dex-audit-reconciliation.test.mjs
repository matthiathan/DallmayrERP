import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20260916060000_dex_audit_reconciliation_state.sql', import.meta.url),
  'utf8',
);

const dexIngest = migration.match(
  /create or replace function public\.ingest_telemetry_dex_audit_snapshot_v1[\s\S]*?\$function\$;/i,
)?.[0] ?? '';
const v5 = migration.match(
  /create or replace function public\.ingest_telemetry_payload_v5[\s\S]*?\$function\$;/i,
)?.[0] ?? '';
const v3 = migration.match(
  /create or replace function public\.ingest_telemetry_payload_v3[\s\S]*?\$function\$;/i,
)?.[0] ?? '';

test('DEX audit state is cumulative, RLS protected, and separate from sales accounting', () => {
  assert.match(migration, /create table if not exists public\.telemetry_dex_audit_state/i);
  assert.match(migration, /primary key \(device_id, selection_code\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /current_app_role\(\) in \('admin', 'executive'\)/i);
  assert.doesNotMatch(dexIngest, /insert into public\.telemetry_daily_item_sales/i);
  assert.doesNotMatch(dexIngest, /update public\.telemetry_daily_item_sales/i);
});

test('first DEX observation is a baseline and cannot manufacture historical sales evidence', () => {
  assert.match(dexIngest, /if not found then[\s\S]*insert into public\.telemetry_dex_audit_state/i);
  assert.match(dexIngest, /v_baselined := v_baselined \+ 1;[\s\S]*continue;/i);
});

test('DEX counter decreases rotate the audit generation without adding evidence', () => {
  const resetBlock = dexIngest.match(/if v_sold < v_state\.sold_total then[\s\S]*?continue;/i)?.[0] ?? '';
  assert.match(resetBlock, /v_generation := v_generation \+ 1/);
  assert.match(resetBlock, /dex_counter_reset/i);
  assert.doesNotMatch(resetBlock, /record_telemetry_vend_evidence/i);
});

test('DEX increases create bounded idempotent reconciliation evidence only', () => {
  assert.match(dexIngest, /v_delta := v_sold - v_state\.sold_total/i);
  assert.match(dexIngest, /while v_remaining > 0 loop/i);
  assert.match(dexIngest, /least\(v_remaining, 100000::bigint\)/i);
  assert.match(dexIngest, /'event', 'dex_sale_delta'/i);
  assert.match(dexIngest, /'source', 'dex'/i);
  assert.match(dexIngest, /'confidence_score', 80/i);
  assert.match(dexIngest, /md5\(lower\(btrim\(v_selection\)\)\)/i);
  assert.match(dexIngest, /'accounting_source', 'counter_snapshot'/i);
});

test('stable V3 ingest route dispatches DEX snapshots through V5 and preserves all older payloads through V4', () => {
  assert.match(v5, /dex_audit_snapshot/i);
  assert.match(v5, /ingest_telemetry_dex_audit_snapshot_v1/i);
  assert.match(v5, /ingest_telemetry_payload_v4/i);
  assert.match(v3, /ingest_telemetry_payload_v5/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /to service_role/i);
});
