import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260921130000_align_fleet_with_effective_profile_resolution.sql', import.meta.url), 'utf8');
const fleet = fs.readFileSync(new URL('../../components/telemetry-platform/MachineFleetBrowser.tsx', import.meta.url), 'utf8');

test('fleet uses the established effective decoder profile resolver', () => {
  assert.match(migration, /resolve_telemetry_device_profile_region_unscoped\(d\.id\)/);
  assert.match(migration, /effective_profile_key/);
  assert.match(migration, /applied_profile_key/);
  assert.match(migration, /profile_resolution/);
  assert.match(migration, /profile_confidence/);
  assert.match(migration, /automatic_ambiguous/);
  assert.match(migration, /is distinct from nullif\(pr\.resolution->>'effective_profile_key',''\)/);
});

test('profile attention distinguishes ambiguity from unmatched and pending delivery', () => {
  assert.match(migration, /profile_status in \('ambiguous','unmatched','pending'\)/);
  assert.match(migration, /when 'ambiguous' then 1/);
  assert.match(fleet, /type ProfileStatus = 'configured' \| 'pending' \| 'ambiguous' \| 'unmatched' \| 'unlinked'/);
  assert.match(fleet, /effective_profile_key: string \| null/);
  assert.match(fleet, /profile_resolution: string \| null/);
  assert.match(fleet, /Automatic · ambiguous/);
  assert.match(fleet, /Unmatched, ambiguous or pending/);
});

test('automatic matches do not require a stored manual profile override', () => {
  assert.doesNotMatch(fleet, /if \(!machine\.profile_id\) return 'Automatic · unmatched'/);
  assert.match(fleet, /machine\.profile_display_name \?\? machine\.effective_profile_key \?\? machine\.profile_model_key/);
});
