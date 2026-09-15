import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260910061114_telemetry_machine_identification_profiles.sql', import.meta.url), 'utf8');
const evidenceMigration = fs.readFileSync(new URL('../../supabase/migrations/20260915120500_machine_identity_evidence_scoring.sql', import.meta.url), 'utf8');
const ingest = fs.readFileSync(new URL('../../supabase/functions/telemetry-ingest/index.ts', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../supabase/functions/telemetry-config/index.ts', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../../components/telemetry-platform/MachineIdentityProfilePanel.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../../components/telemetry-platform/MachineDetail.tsx', import.meta.url), 'utf8');
const testCenter = fs.readFileSync(new URL('../../components/features/TelemetryTestCenter.tsx', import.meta.url), 'utf8');

test('machine identity evidence is persisted without changing the machine master', () => {
  for (const column of [
    'reported_machine_model',
    'reported_machine_revision',
    'reported_machine_asset',
    'reported_machine_identity_source',
    'reported_machine_profile_fingerprint',
    'reported_machine_interface',
    'reported_machine_identity_at',
  ]) assert.match(migration, new RegExp(column));

  assert.match(ingest, /payload\.machine_identity/);
  assert.match(ingest, /patch\.reported_machine_interface/);
  assert.match(ingest, /patch\.reported_machine_model/);
  assert.match(ingest, /patch\.reported_machine_profile_fingerprint/);
  assert.doesNotMatch(ingest, /from\('machines'\)\.update/);
});

test('verified evidence scoring is conservative and does not seed guessed fingerprints', () => {
  assert.match(evidenceMigration, /create table if not exists public\.machine_model_profile_identity_evidence/i);
  for (const type of ['fingerprint', 'interface', 'model_alias', 'revision']) {
    assert.match(evidenceMigration, new RegExp(`'${type}'`));
  }
  assert.match(evidenceMigration, /verified boolean not null default false/i);
  assert.match(evidenceMigration, /where evidence_type = 'fingerprint' and verified = true/i);
  assert.match(evidenceMigration, /create or replace function public\.resolve_telemetry_device_profile/i);
  assert.match(evidenceMigration, /when s\.fingerprint_match then 150/i);
  assert.match(evidenceMigration, /when ev\.model_alias_match then 105/i);
  assert.match(evidenceMigration, /then 100/);
  assert.match(evidenceMigration, /then 95/);
  assert.match(evidenceMigration, /v_interface_norm <> '' and s\.has_interface_rule and not s\.interface_match then 0/i);
  assert.match(evidenceMigration, /if v_top_score < 80 then/i);
  assert.match(evidenceMigration, /elsif v_gap < 15 then/i);
  assert.match(evidenceMigration, /automatic_ambiguous/i);
  assert.doesNotMatch(evidenceMigration, /insert\s+into\s+public\.machine_model_profile_identity_evidence/i);
});

test('profile assignment keeps manual override authoritative and shares one automatic resolver', () => {
  assert.match(migration, /profile_assignment_method text not null default 'automatic'/);
  assert.match(migration, /set_telemetry_device_profile/);
  assert.match(migration, /v_method not in \('automatic','manual'\)/);
  assert.match(evidenceMigration, /profile_assignment_method, 'automatic'\) = 'manual'/i);
  assert.match(evidenceMigration, /v_resolution := 'manual'/i);
  assert.match(evidenceMigration, /'profile_assignment_method', 'manual'/i);
  assert.match(evidenceMigration, /'profile_resolution', v_resolution/i);
  assert.match(evidenceMigration, /get_telemetry_machine_identity/i);
  assert.match(evidenceMigration, /resolve_telemetry_device_profile\(v_device\.id\)/i);
  assert.match(evidenceMigration, /Serial mismatch/);
  assert.match(evidenceMigration, /Model mismatch/);
  assert.match(evidenceMigration, /profile_pending/);
  assert.match(config, /rpc\('resolve_telemetry_device_profile'/);
  assert.match(config, /profileResult\.effective_profile_key/);
  assert.match(config, /profileResult\.profile_resolution/);
  assert.match(config, /profile_id: effectiveProfileId/);
  assert.doesNotMatch(config, /profileMatchScore/);
  assert.doesNotMatch(config, /\.from\('machine_model_profiles'\)/);
});

test('identity evidence registry and resolver keep anonymous callers out', () => {
  assert.match(evidenceMigration, /alter table public\.machine_model_profile_identity_evidence enable row level security/i);
  assert.match(evidenceMigration, /revoke all on public\.machine_model_profile_identity_evidence from anon/i);
  assert.match(evidenceMigration, /revoke all on function public\.resolve_telemetry_device_profile\(uuid\) from public, anon/i);
  assert.match(evidenceMigration, /grant execute on function public\.resolve_telemetry_device_profile\(uuid\) to authenticated, service_role/i);
  assert.match(evidenceMigration, /auth\.uid\(\) is not null and public\.current_app_role\(\) is null/i);
});

test('machine dashboard exposes identification evidence, conflicts and profile controls', () => {
  assert.match(detail, /MachineIdentityProfilePanel/);
  assert.match(detail, /get_telemetry_machine_identity/);
  assert.match(detail, /effective_profile_key/);
  assert.match(panel, /Detected protocol/);
  assert.match(panel, /Effective profile/);
  assert.match(panel, /Identity requires attention/);
  assert.match(panel, /Automatic selection/);
  assert.match(panel, /Automatic · ambiguous/);
  assert.match(panel, /Manual override/);
  assert.match(panel, /set_telemetry_device_profile/);
  assert.match(panel, /Manage machine profiles & product mappings/);
  assert.match(panel, /Open this device in Test Center/);
  assert.doesNotMatch(panel, /score \{recommendation\.score\}\/100/);
});

test('machine product mapping follows the effective decoder profile', () => {
  assert.match(detail, /effectiveProfileKey/);
  assert.match(detail, /get_machine_model_button_map/);
  assert.match(detail, /const modelKey = effectiveProfileKey \|\| nextMachine\.model/);
});

test('machine identity action deep-links to the selected Test Center device', () => {
  assert.match(panel, /telemetry\/test-center\?device=/);
  assert.match(testCenter, /URLSearchParams\(window\.location\.search\)/);
  assert.match(testCenter, /requestedDeviceCode/);
  assert.match(testCenter, /item\.device_code\.toLocaleLowerCase/);
  assert.match(testCenter, /search\.trim\(\)\.toLocaleLowerCase/);
});
