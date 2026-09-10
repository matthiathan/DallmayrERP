import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260910061114_telemetry_machine_identification_profiles.sql', import.meta.url), 'utf8');
const fixMigration = fs.readFileSync(new URL('../../supabase/migrations/20260910062253_fix_telemetry_machine_identity_recommendation.sql', import.meta.url), 'utf8');
const ingest = fs.readFileSync(new URL('../../supabase/functions/telemetry-ingest/index.ts', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../supabase/functions/telemetry-config/index.ts', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../../components/telemetry-platform/MachineIdentityProfilePanel.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../../components/telemetry-platform/MachineDetail.tsx', import.meta.url), 'utf8');

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

test('profile assignment supports deterministic automatic matching and explicit manual override', () => {
  assert.match(migration, /profile_assignment_method text not null default 'automatic'/);
  assert.match(migration, /set_telemetry_device_profile/);
  assert.match(migration, /v_method not in \('automatic','manual'\)/);
  assert.match(fixMigration, /get_telemetry_machine_identity/);
  assert.match(fixMigration, /recommended_profile/);
  assert.match(fixMigration, /profile_pending/);
  assert.match(fixMigration, /Serial mismatch/);
  assert.match(fixMigration, /Model mismatch/);
  assert.match(config, /profileMatchScore/);
  assert.match(config, /automatic_match/);
  assert.match(config, /automatic_unmatched/);
  assert.match(config, /profile_id: effectiveProfileId/);
});

test('machine dashboard exposes identification evidence, conflicts and profile controls', () => {
  assert.match(detail, /MachineIdentityProfilePanel/);
  assert.match(detail, /get_telemetry_machine_identity/);
  assert.match(detail, /effective_profile_key/);
  assert.match(panel, /Detected protocol/);
  assert.match(panel, /Effective profile/);
  assert.match(panel, /Identity requires attention/);
  assert.match(panel, /Automatic selection/);
  assert.match(panel, /Manual override/);
  assert.match(panel, /set_telemetry_device_profile/);
  assert.match(panel, /Manage machine profiles & product mappings/);
  assert.match(panel, /Open this device in Test Center/);
});

test('machine product mapping follows the effective decoder profile', () => {
  assert.match(detail, /effectiveProfileKey/);
  assert.match(detail, /get_machine_model_button_map/);
  assert.match(detail, /const modelKey = effectiveProfileKey \|\| nextMachine\.model/);
});
