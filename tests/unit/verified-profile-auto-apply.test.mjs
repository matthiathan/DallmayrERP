import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsUrl), 'utf8'))
  .join('\n');

test('automatic decoder profiles are persisted only from unique verified identity evidence', () => {
  assert.match(migrations, /create\s+or\s+replace\s+function\s+private\.apply_verified_telemetry_profile_identity_internal_v1\b/i);
  assert.match(migrations, /profile_assignment_method[\s\S]*manual[\s\S]*return/i);
  assert.match(migrations, /machine_model_profile_identity_evidence[\s\S]*verified\s*=\s*true/i);
  assert.match(migrations, /select\s+distinct\s+e\.profile_id[\s\S]*select\s+count\s*\(\s*\*\s*\)::integer/i);
  assert.match(migrations, /if\s+v_match_count\s*=\s*1[\s\S]*profile_id\s*=\s*v_profile_key/i);
  assert.match(migrations, /v_match_count\s*<>\s*1[\s\S]*profile_id\s*=\s*null/i);
});

test('device identity changes and newly verified evidence reconcile automatic profile assignments', () => {
  assert.match(migrations, /create\s+trigger\s+telemetry_devices_auto_apply_verified_profile_on_identity/i);
  assert.match(migrations, /reported_machine_profile_fingerprint/i);
  assert.match(migrations, /reported_machine_model/i);
  assert.match(migrations, /create\s+trigger\s+telemetry_profile_evidence_reconcile_devices/i);
  assert.match(migrations, /after\s+insert\s+or\s+update\s+of\s+verified/i);
});
