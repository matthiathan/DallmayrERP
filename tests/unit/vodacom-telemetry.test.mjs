import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const configFunction = fs.readFileSync(new URL('../../supabase/functions/telemetry-config/index.ts', import.meta.url), 'utf8');
const ingestFunction = fs.readFileSync(new URL('../../supabase/functions/telemetry-ingest/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260820083000_vodacom_test_and_data_usage.sql', import.meta.url), 'utf8');
const deviceManagement = fs.readFileSync(new URL('../../components/features/AdminTelemetryDevices.tsx', import.meta.url), 'utf8');
const testRunner = fs.readFileSync(new URL('../../scripts/test-vodacom-telemetry.mjs', import.meta.url), 'utf8');
const supabaseConfig = fs.readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
const firmware = fs.readFileSync(new URL('../../firmware/DallmayrTelemetryV6_1/DallmayrTelemetryV6_1.ino', import.meta.url), 'utf8');

test('device configuration returns the verified Vodacom South Africa profile', () => {
  assert.match(configFunction, /carrier: 'Vodacom South Africa'/);
  assert.match(configFunction, /apn: 'internet'/);
  assert.match(configFunction, /username: 'guest'/);
  assert.match(configFunction, /authentication: 'pap'/);
  assert.match(configFunction, /mcc: '655'/);
  assert.match(configFunction, /mnc: '01'/);
});

test('accepted telemetry records server, device-application and optional modem byte counters', () => {
  assert.match(ingestFunction, /record_telemetry_data_usage/);
  assert.match(ingestFunction, /usagePayload\.application_tx_bytes_total/);
  assert.match(ingestFunction, /usagePayload\.application_rx_bytes_total/);
  assert.match(ingestFunction, /usagePayload\.tx_bytes_total/);
  assert.match(ingestFunction, /usagePayload\.rx_bytes_total/);
  assert.match(migration, /create table if not exists public\.telemetry_data_usage_daily/);
  assert.match(migration, /create or replace function public\.get_telemetry_data_usage/);
  assert.match(deviceManagement, /Mobile data usage · last 30 days/);
  assert.match(deviceManagement, /Fleet total · last 30 days/);
  assert.match(deviceManagement, /Device-reported transfer/);
  assert.match(deviceManagement, /Modem measured/);
  assert.match(deviceManagement, /Telemetry payload/);
});

test('safe test runner cannot claim cellular transport without explicit confirmation', () => {
  assert.match(testRunner, /type: 'simulation_snapshot'/);
  assert.match(testRunner, /TELEMETRY_TEST_CELLULAR_CONFIRMED/);
  assert.match(testRunner, /TELEMETRY_TEST_ANON_KEY/);
  assert.match(testRunner, /authorization: `Bearer \$\{anonKey\}`/);
  assert.match(testRunner, /requestedTransport === 'cellular' && !cellularConfirmed/);
  assert.match(testRunner, /daily_delta_units/);
});

test('device-facing telemetry functions keep gateway JWT verification enabled', () => {
  for (const functionName of ['telemetry-ingest', 'telemetry-config', 'telemetry-enroll']) {
    assert.match(supabaseConfig, new RegExp(`\\[functions\\.${functionName}\\]\\nverify_jwt = true`));
  }
  assert.match(ingestFunction, /authorization, apikey/);
  assert.match(configFunction, /authorization, apikey/);
});

test('Air780E firmware performs a cellular-only simulation test and reports application bytes', () => {
  assert.match(firmware, /6\.1\.0-esp32s3-vodacom-data-test/);
  assert.match(firmware, /SIM DATA TEST/);
  assert.match(firmware, /sendCellularSimulationSnapshot/);
  assert.match(firmware, /airHttpPost\(INGEST_URL/);
  assert.match(firmware, /"simulation_snapshot"/);
  assert.match(firmware, /application_tx_bytes_total/);
  assert.match(firmware, /application_rx_bytes_total/);
  assert.match(firmware, /Authorization: Bearer/);
  assert.match(firmware, /SUPABASE ANON KEY/);
  assert.match(firmware, /dailyUnits != 1 \|\| dailyRevenue != 1500/);
});
