import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsUrl), 'utf8'))
  .join('\n');
const workspace = fs.readFileSync(new URL('../../components/telemetry-platform/ProfileIdentityEvidenceWorkspace.tsx', import.meta.url), 'utf8');

test('profile identity candidate exposes bounded verification audit attribution', () => {
  assert.match(migrations, /get_telemetry_profile_identity_candidate/);
  assert.match(migrations, /verified_by_name/);
  assert.match(migrations, /source_device_code/);
  assert.match(migrations, /source_telemetry_region/);
  assert.match(migrations, /notes/);
  assert.match(migrations, /verified_at/);
});

test('profile identity workspace renders verification audit details', () => {
  assert.match(workspace, /verified_by_name/);
  assert.match(workspace, /source_device_code/);
  assert.match(workspace, /Verification note/);
  assert.match(workspace, /Verified by/);
  assert.match(workspace, /Source/);
});
