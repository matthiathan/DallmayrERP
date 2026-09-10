import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const fleet = fs.readFileSync(new URL('../../components/telemetry-platform/MachineFleetBrowser.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../../components/telemetry-platform/MachineDetail.tsx', import.meta.url), 'utf8');
const createImport = fs.readFileSync(new URL('../../components/features/MachineCreateImportControls.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260910064741_telemetry_machine_fleet_operational_status.sql', import.meta.url), 'utf8');

test('machine fleet exposes operational attention filters and persisted views', () => {
  assert.match(fleet, /profile_attention/);
  assert.match(fleet, /unconnected/);
  assert.match(fleet, /active_faults/);
  assert.match(fleet, /FILTER_STORAGE_KEY/);
  assert.match(fleet, /window\.localStorage\.setItem/);
  assert.match(fleet, /Clear saved filters/);
  assert.match(fleet, /Automatic · unmatched/);
  assert.match(fleet, /telemetry\/test-center\?device=/);
  assert.match(migration, /v_status = 'profile_attention'/);
  assert.match(migration, /v_status = 'faults'/);
  assert.match(migration, /profile_assignment_method/);
  assert.match(migration, /reported_machine_interface/);
});

test('machine create and import workflow captures telemetry-relevant master data', () => {
  assert.match(createImport, /Machine Type \/ Model/);
  assert.match(createImport, /Brand \/ Manufacturer/);
  assert.match(createImport, /Site \/ Location/);
  assert.match(createImport, /site_id: site\?\.id \?\? null/);
  assert.match(createImport, /model,/);
  assert.match(createImport, /manufacturer,/);
  assert.match(createImport, /Download error report/);
  assert.match(createImport, /dallmayr-machine-import-errors\.csv/);
  assert.match(createImport, /MAX_IMPORT_ROWS = 5000/);
});

test('machine dashboard provides direct operational actions', () => {
  assert.match(detail, /aria-label="Machine quick actions"/);
  assert.match(detail, /Fault history/);
  assert.match(detail, /Device & profile/);
  assert.match(detail, /Test Center/);
  assert.match(detail, /Device Management/);
  assert.match(detail, /Product mappings/);
  assert.match(detail, /Refresh now/);
});
