import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformTelemetryV649 } from '../../scripts/generate-telemetry-v6-8-49.mjs';

const baseFirmware = fs.readFileSync(new URL('../../firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260915085000_telemetry_selection_learn_mode.sql', import.meta.url), 'utf8');
const routerMigration = fs.readFileSync(new URL('../../supabase/migrations/20260915085200_route_selection_observations_through_ingest_v3.sql', import.meta.url), 'utf8');
const quickMapMigration = fs.readFileSync(new URL('../../supabase/migrations/20260915085500_assign_learned_selection_mapping.sql', import.meta.url), 'utf8');
const learnPanel = fs.readFileSync(new URL('../../components/features/SelectionLearnModePanel.tsx', import.meta.url), 'utf8');

const generated = transformTelemetryV649(baseFirmware);

test('V6.8.49 keeps MDB passive while emitting selection lifecycle observations', () => {
  assert.match(generated, /6\.8\.49-esp32s3-air780eu-passive-mdb-selection-learn/);
  assert.match(generated, /DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/);
  assert.match(generated, /MDB_EVENT_SELECTION_OBSERVATION/);
  assert.match(generated, /"selection_observation"/);
  assert.match(generated, /MDB_SELECTION_REQUESTED/);
  assert.match(generated, /MDB_SELECTION_APPROVED/);
  assert.match(generated, /MDB_SELECTION_DENIED/);
  assert.match(generated, /MDB_SELECTION_SUCCESS/);
  assert.match(generated, /MDB_SELECTION_FAILURE/);
  assert.match(generated, /selection == 0xFFFF/);
  assert.match(generated, /sendDocumentToIngest\(doc\)/);
});

test('Learn Mode observations are isolated from production counters and idempotent', () => {
  assert.match(migration, /create table if not exists public\.telemetry_selection_observations/i);
  assert.match(migration, /unique \(device_id, event_id\)/i);
  assert.match(migration, /ingest_telemetry_selection_observation_v1/i);
  assert.doesNotMatch(migration, /insert into public\.telemetry_counter_state/i);
  assert.doesNotMatch(migration, /insert into public\.telemetry_daily_item_sales/i);
  assert.match(routerMigration, /ingest_telemetry_payload_v3_core/i);
  assert.match(routerMigration, /selection_observation/i);
});

test('Products Learn Mode can map a learned raw code without inventing button IDs', () => {
  assert.match(learnPanel, /get_recent_telemetry_selection_observations/);
  assert.match(learnPanel, /assign_learned_selection_mapping/);
  assert.match(learnPanel, /For a touchscreen, Slot is only a logical mapping slot/);
  assert.match(quickMapMigration, /p_selection_code text/i);
  assert.match(quickMapMigration, /p_slot_number integer/i);
});
