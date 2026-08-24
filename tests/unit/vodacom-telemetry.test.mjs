import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const configFunction = fs.readFileSync(new URL('../../supabase/functions/telemetry-config/index.ts', import.meta.url), 'utf8');
const ingestFunction = fs.readFileSync(new URL('../../supabase/functions/telemetry-ingest/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260820083000_vodacom_test_and_data_usage.sql', import.meta.url), 'utf8');
const deviceManagement = fs.readFileSync(new URL('../../components/features/AdminTelemetryDevices.tsx', import.meta.url), 'utf8');
const testRunner = fs.readFileSync(new URL('../../scripts/test-vodacom-telemetry.mjs', import.meta.url), 'utf8');
const supabaseConfig = fs.readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
const firmware = fs.readFileSync(new URL('../../firmware/DallmayrTelemetryV6_8_12/DallmayrTelemetryV6_8_12.ino', import.meta.url), 'utf8');

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
  assert.match(firmware, /6\.8\.12-esp32s3-air780eu-httpinit-first/);
  assert.match(firmware, /SIM DATA TEST/);
  assert.match(firmware, /sendCellularSimulationSnapshot/);
  assert.match(firmware, /airHttpPost\(INGEST_URL/);
  assert.match(firmware, /"simulation_snapshot"/);
  assert.match(firmware, /application_tx_bytes_total/);
  assert.match(firmware, /application_rx_bytes_total/);
  assert.match(firmware, /setAir780HttpHeader\("Authorization", "Bearer " \+ supabaseAnonKey\)/);
  assert.match(firmware, /SUPABASE ANON KEY/);
  assert.match(firmware, /dailyUnits != 1 \|\| dailyRevenue != 1500/);
});

test('Air780EU V1180 initializes HTTP before configuring context 153 and keeps repository credentials blank', () => {
  const beginStart = firmware.indexOf('bool beginAir780HttpsSession()');
  const beginEnd = firmware.indexOf('bool setAir780HttpHeader', beginStart);
  const beginBody = firmware.slice(beginStart, beginEnd);
  const httpInit = beginBody.indexOf('cellCommand("AT+HTTPINIT"');
  const configureTls = beginBody.indexOf('configureAir780TlsContext()');
  const configureStart = firmware.indexOf('bool configureAir780TlsContext()');
  const configureEnd = firmware.indexOf('bool restartAir780AfterHttpStall()', configureStart);
  const configureBody = firmware.slice(configureStart, configureEnd);
  const enableHttps = configureBody.indexOf('enableAir780Https()');
  const tlsVersion = configureBody.indexOf('AT+SSLCFG=\\"sslversion\\",153,3');
  const cipherSuite = configureBody.indexOf('AT+SSLCFG=\\"ciphersuite\\",153,0XFFFF');
  const securityLevel = configureBody.indexOf('AT+SSLCFG=\\"seclevel\\",153,0');
  const hostname = configureBody.indexOf('AT+SSLCFG=\\"hostname\\",153');

  assert.ok(beginStart >= 0);
  assert.ok(httpInit >= 0);
  assert.ok(configureTls > httpInit);
  assert.ok(enableHttps >= 0);
  assert.ok(tlsVersion > enableHttps);
  assert.ok(cipherSuite > tlsVersion);
  assert.ok(securityLevel > cipherSuite);
  assert.ok(hostname > securityLevel);
  assert.match(firmware, /AT\+SSLCFG=\\"ignorelocaltime\\",153,1/);
  assert.match(firmware, /AT\+SSLCFG=\\"negotiatetimeout\\",153,30/);
  assert.match(firmware, /bool restartAir780AfterHttpStall\(\)/);
  assert.match(firmware, /AT\+CFUN=1,1/);
  assert.match(firmware, /endAir780HttpSession\(true\)/);
  assert.match(firmware, /statusCode == 605/);
  assert.match(firmware, /SSL channel establishment failed \(605\)/);
  assert.match(firmware, /setAir780HttpHeader\("Authorization", "Bearer " \+ supabaseAnonKey\)/);
  assert.match(firmware, /setAir780HttpHeader\("apikey", supabaseAnonKey\)/);
  assert.match(firmware, /setAir780HttpHeader\("X-Device-ID", deviceId\)/);
  assert.match(firmware, /setAir780HttpHeader\("X-Device-Key", deviceKey\)/);
  assert.match(firmware, /AT\+HTTPPARA=\\"USER_DEFINED\\"/);
  assert.doesNotMatch(firmware, /String headerCmd = "AT\+HTTPPARA=\\"USERDATA/);
  assert.match(firmware, /Sensitive modem response redacted/);
  assert.match(firmware, /if \(strcmp\(expected, "OK"\) == 0\) successToken = "\\r\\nOK\\r\\n"/);
  assert.match(firmware, /#define DALLMAYR_SIM_DATA_TEST_ENABLED\s+true/);
  assert.match(firmware, /#define DALLMAYR_SIM_DATA_TEST_AUTO_RUN\s+false/);
  assert.match(firmware, /#define DALLMAYR_WIFI_SSID\s+""/);
  assert.match(firmware, /#define DALLMAYR_WIFI_PASSWORD\s+""/);
  assert.match(firmware, /#define DALLMAYR_SUPABASE_ANON_KEY\s+""/);
  assert.doesNotMatch(firmware, /AT\+HTTPPARA=\\"TIMEOUT\\"/);
});

test('Air780EU SSL configuration failures reset the separate modem without looping forever', () => {
  const configurationFailure = firmware.indexOf('Air780E HTTPS TLS context configuration failed.');
  const recoveryAfterFailure = firmware.indexOf('restartAir780AfterHttpStall();', configurationFailure);

  assert.ok(configurationFailure >= 0);
  assert.ok(recoveryAfterFailure > configurationFailure);
  assert.match(firmware, /uint8_t air780HttpRecoveryCount = 0/);
  assert.match(firmware, /if \(air780HttpRecoveryCount >= 2\)/);
  assert.match(firmware, /air780HttpRecoveryCount\+\+/);
  assert.match(firmware, /air780HttpRecoveryCount = 0;\n\s+int p = action\.lastIndexOf/);
});

test('ESP32-S3 passive MDB capture uses an RMT-safe noise filter', () => {
  assert.match(firmware, /MDB_NOISE_FILTER_TICKS = 3/);
  assert.match(firmware, /rmtSetRxMinThreshold\(MDB_VMC_TX_MONITOR_PIN, MDB_NOISE_FILTER_TICKS\)/);
  assert.match(firmware, /rmtSetRxMinThreshold\(MDB_VMC_RX_MONITOR_PIN, MDB_NOISE_FILTER_TICKS\)/);
  assert.doesNotMatch(firmware, /MDB_NOISE_FILTER_US = 15/);
});
