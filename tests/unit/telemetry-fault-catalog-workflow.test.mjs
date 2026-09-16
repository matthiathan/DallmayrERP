import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260916093000_fault_catalog_verification_workflow.sql', 'utf8');
const panel = fs.readFileSync('components/telemetry-platform/FaultIntelligencePanel.tsx', 'utf8');
const alertsPage = fs.readFileSync('app/alerts/page.tsx', 'utf8');
const machinePage = fs.readFileSync('app/machines/[id]/page.tsx', 'utf8');

test('fault candidates are evidence-backed and cannot mutate the verified catalogue directly', () => {
  assert.match(migration, /create table if not exists public\.telemetry_fault_rule_candidates/i);
  assert.match(migration, /fault_event_id uuid not null references public\.telemetry_fault_events/i);
  assert.match(migration, /evidence_note text not null/i);
  assert.match(migration, /status text not null default 'pending'/i);
  assert.match(migration, /revoke insert, update, delete on table public\.telemetry_fault_rule_candidates from authenticated/i);
});

test('field technicians can submit but only operations or admin can verify', () => {
  assert.match(migration, /v_role not in \('admin','operations','technician','road_technician'\)/i);
  assert.match(migration, /v_role not in \('admin','operations'\)/i);
  assert.match(migration, /p_action.*verify.*reject/is);
});

test('verification activates a rule and enriches only matching open raw events', () => {
  assert.match(migration, /is_verified = true/i);
  assert.match(migration, /is_active = true/i);
  assert.match(migration, /normalization_status = 'verified_rule'/i);
  assert.match(migration, /where device_id = v_candidate\.device_id\s+and cleared_at is null/is);
  assert.match(migration, /lower\(btrim\(fault_code\)\) = lower\(btrim\(v_candidate\.raw_fault_code\)\)/i);
});

test('fault intelligence UI always keeps raw code visible beside normalized meaning', () => {
  assert.match(panel, /Raw code/);
  assert.match(panel, /fault\.fault_code/);
  assert.match(panel, /canonical_fault_code/);
  assert.match(panel, /recommended_action/);
  assert.match(panel, /No verified technician action yet/);
});

test('workbench uses proposal and review RPCs rather than direct rule writes', () => {
  assert.match(panel, /submit_telemetry_fault_rule_candidate_v1/);
  assert.match(panel, /review_telemetry_fault_rule_candidate_v1/);
  assert.doesNotMatch(panel, /from\('machine_model_fault_rules'\)\.insert/);
  assert.doesNotMatch(panel, /from\('machine_model_fault_rules'\)\.update/);
});

test('alerts and machine dashboard both expose fault intelligence', () => {
  assert.match(alertsPage, /<FaultIntelligencePanel management \/>/);
  assert.match(machinePage, /<FaultIntelligencePanel machineId=\{id\} \/>/);
});
