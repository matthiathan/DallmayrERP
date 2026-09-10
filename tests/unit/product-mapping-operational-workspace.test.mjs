import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workspace = fs.readFileSync(new URL('../../components/features/ProductMappingWorkspace.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260910093500_product_mapping_operational_workspace.sql', import.meta.url), 'utf8');

test('product mapping workspace exposes operational completeness and unmapped selection controls', () => {
  assert.match(workspace, /Mapping completeness/i);
  assert.match(workspace, /Unmapped selections/i);
  assert.match(workspace, /Needs mapping/i);
  assert.match(workspace, /Copy mapping/i);
  assert.match(workspace, /Mapping history/i);
  assert.match(workspace, /get_product_mapping_operational_summary/);
  assert.match(workspace, /copy_machine_model_profile_mappings/);
});

test('product mapping backend exposes completeness, observed unmapped selections and safe copy RPC', () => {
  assert.match(migration, /create or replace function public\.get_product_mapping_operational_summary/i);
  assert.match(migration, /create or replace function public\.copy_machine_model_profile_mappings/i);
  assert.match(migration, /telemetry_counter_state/i);
  assert.match(migration, /machine_model_button_mappings/i);
  assert.match(migration, /on conflict \(profile_id, button_number\)/i);
  assert.match(migration, /to authenticated/i);
});
