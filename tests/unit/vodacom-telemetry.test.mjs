import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const configFunction = fs.readFileSync(new URL('../../supabase/functions/telemetry-config/index.ts', import.meta.url), 'utf8');
const ingestFunction = fs.readFileSync(new URL('../../supabase/functions/telemetry-ingest/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260820083000_vodacom_test_and_data_usage.sql', import.meta.url), 'utf8');
const prepaidMigration = fs.readFileSync(new URL('../../supabase/migrations/20260825103000_telemetry_prepaid_balance_monitoring.sql', import.meta.url), 'utf8');
const prepaidUssdMigration = fs.readFileSync(new URL('../../supabase/migrations/20260825122510_vodacom_prepaid_balance_111_502.sql', import.meta.url), 'utf8');
const deviceManagement = fs.readFileSync(new URL('../../components/features/AdminTelemetryDevices.tsx', import.meta.url), 'utf8');
const testRunner = fs.readFileSync(new URL('../../scripts/test-vodacom-telemetry.mjs', import.meta.url), 'utf8');
const supabaseConfig = fs.readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
const firmware = fs.readFileSync(new URL('../../firmware/DallmayrTelemetryV6_8_19/DallmayrTelemetryV6_8_19.ino', import.meta.url), 'utf8');

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
  assert.match(deviceManagement, /Fleet total · last 30 days/);
  assert.match(deviceManagement, /Mobile data usage and balance/);
  assert.match(deviceManagement, /Mobile data · usage and balance/);
  assert.match(deviceManagement, /Used · last 30 days/);
  assert.match(deviceManagement, /Prepaid remaining/);
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
  assert.match(firmware, /6\.8\.19-esp32s3-air780eu-ussd-auto-register/);
  assert.match(firmware, /SIM DATA TEST/);
  assert.match(firmware, /sendCellularSimulationSnapshot/);
  assert.match(firmware, /airHttpPost\(INGEST_URL/);
  assert.match(firmware, /"simulation_snapshot"/);
  assert.match(firmware, /application_tx_bytes_total/);
  assert.match(firmware, /application_rx_bytes_total/);
  assert.match(firmware, /String headers = "Authorization: Bearer " \+ supabaseAnonKey/);
  assert.match(firmware, /SUPABASE ANON KEY/);
  assert.match(firmware, /dailyUnits != 1 \|\| dailyRevenue != 1500/);
});

test('Air780EU V1180 reopens HTTP and streams POST data through the extended command path', () => {
  const beginStart = firmware.indexOf('bool beginAir780HttpsSession()');
  const beginEnd = firmware.indexOf('bool setAir780CompactHttpHeaders', beginStart);
  const beginBody = firmware.slice(beginStart, beginEnd);
  const httpInit = beginBody.indexOf('cellCommand("AT+HTTPINIT"');
  const configureTls = beginBody.indexOf('configureAir780TlsContext()');
  const reopenMessage = beginBody.indexOf('Reopening Air780E HTTP service after TLS context setup.');
  const terminateAfterConfiguration = beginBody.indexOf('endAir780HttpSession(true)', reopenMessage);
  const reinitializeAfterConfiguration = beginBody.indexOf('cellCommand("AT+HTTPINIT"', terminateAfterConfiguration);
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
  assert.ok(reopenMessage > configureTls);
  assert.ok(terminateAfterConfiguration > reopenMessage);
  assert.ok(reinitializeAfterConfiguration > terminateAfterConfiguration);
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
  assert.match(firmware, /String headers = "Authorization: Bearer " \+ supabaseAnonKey/);
  assert.match(firmware, /headers \+= "\\\\r\\\\nX-Device-ID: " \+ deviceId/);
  assert.match(firmware, /"\\\\r\\\\nX-Device-Key: " \+ deviceKey/);
  assert.match(firmware, /String command = "AT\+HTTPPARA=\\"USERDATA\\",\\"" \+ headers \+ "\\""/);
  assert.match(firmware, /if \(command\.length\(\) > 480\)/);
  assert.doesNotMatch(firmware, /setAir780HttpHeader\(/);
  assert.doesNotMatch(firmware, /setAir780HttpHeader\("apikey"/);
  assert.doesNotMatch(firmware, /"\\\\r\\\\napikey: "/);
  assert.match(firmware, /Sensitive modem response redacted/);
  assert.match(firmware, /if \(strcmp\(expected, "OK"\) == 0\) successToken = "\\r\\nOK\\r\\n"/);
  assert.match(firmware, /#define DALLMAYR_SIM_DATA_TEST_ENABLED\s+true/);
  assert.match(firmware, /#define DALLMAYR_SIM_DATA_TEST_AUTO_RUN\s+false/);
  assert.match(firmware, /#define DALLMAYR_WIFI_SSID\s+""/);
  assert.match(firmware, /#define DALLMAYR_WIFI_PASSWORD\s+""/);
  assert.match(firmware, /#define DALLMAYR_SUPABASE_ANON_KEY\s+""/);
  assert.match(firmware, /AIR780_HTTP_TIMEOUT_SECONDS = 45/);
  assert.match(firmware, /AIR780_HTTP_ACTION_WAIT_MS/);
  assert.match(firmware, /AIR780_HTTP_POST_CHUNK_TIMEOUT_MS = 15000UL/);
  assert.match(firmware, /AT\+HTTPPARA=\\"TIMEOUT\\"," \+ String\(AIR780_HTTP_TIMEOUT_SECONDS\)/);
  assert.match(firmware, /AT\+HTTPEXACTION=1,/);
  assert.match(firmware, /\+HTTPEXPOST\\r\\n/);
  assert.match(firmware, /AT\+HTTPEXPOST=/);
  assert.match(firmware, /AT\+HTTPEXGET\\r\\n/);
  assert.match(firmware, /\+HTTPEXGET:/);
  assert.match(firmware, /event\.lastIndexOf\("\+HTTPEXACTION:"\)/);
  assert.match(firmware, /acknowledgedLength\.toInt\(\) != static_cast<int>\(json\.length\(\)\)/);
  assert.doesNotMatch(firmware, /CellSerial\.print\("AT\+HTTPDATA=/);
  assert.doesNotMatch(firmware, /CellSerial\.print\("AT\+HTTPACTION=1/);
  assert.doesNotMatch(firmware, /CellSerial\.print\("AT\+HTTPREAD/);
  assert.match(firmware, /\+SAPBR 1: DEACT/);
  assert.match(firmware, /\+CGEV: NW PDN DEACT/);
});

test('Air780EU SSL configuration failures reset the separate modem without looping forever', () => {
  const configurationFailure = firmware.indexOf('Air780E HTTPS TLS context configuration failed.');
  const recoveryAfterFailure = firmware.indexOf('restartAir780AfterHttpStall();', configurationFailure);

  assert.ok(configurationFailure >= 0);
  assert.ok(recoveryAfterFailure > configurationFailure);
  assert.match(firmware, /uint8_t air780HttpRecoveryCount = 0/);
  assert.match(firmware, /if \(air780HttpRecoveryCount >= 2\)/);
  assert.match(firmware, /air780HttpRecoveryCount\+\+/);
  assert.match(firmware, /air780HttpRecoveryCount = 0;/);
  assert.match(firmware, /readAir780ExtendedPostResult\(responseBody, statusCode/);
});

test('ESP32-S3 passive MDB capture uses an RMT-safe noise filter', () => {
  assert.match(firmware, /MDB_NOISE_FILTER_TICKS = 3/);
  assert.match(firmware, /rmtSetRxMinThreshold\(MDB_VMC_TX_MONITOR_PIN, MDB_NOISE_FILTER_TICKS\)/);
  assert.match(firmware, /rmtSetRxMinThreshold\(MDB_VMC_RX_MONITOR_PIN, MDB_NOISE_FILTER_TICKS\)/);
  assert.doesNotMatch(firmware, /MDB_NOISE_FILTER_US = 15/);
});


test('Vodacom prepaid balance monitoring is scheduled, stored and operator controlled', () => {
  assert.match(prepaidMigration, /create table if not exists public\.telemetry_prepaid_balance_state/);
  assert.match(prepaidMigration, /create table if not exists public\.telemetry_prepaid_balance_history/);
  assert.match(prepaidMigration, /create or replace function public\.record_telemetry_prepaid_balance/);
  assert.match(prepaidMigration, /create or replace function public\.request_telemetry_prepaid_balance/);
  assert.match(prepaidMigration, /create or replace function public\.set_telemetry_prepaid_balance_control/);
  assert.match(prepaidMigration, /enable row level security/);
  assert.match(prepaidMigration, /warning_threshold_bytes bigint not null default 104857600/);
  assert.match(prepaidMigration, /critical_threshold_bytes bigint not null default 26214400/);
  assert.match(configFunction, /prepaid_balance_due/);
  assert.match(configFunction, /check_interval_minutes: prepaidCheckIntervalMinutes/);
  assert.match(ingestFunction, /record_telemetry_prepaid_balance/);
  assert.match(ingestFunction, /report_pending === true/);
  assert.match(deviceManagement, /Prepaid data balance/);
  assert.match(deviceManagement, /Check balance now/);
  assert.match(deviceManagement, /Top-ups required/);
});

test('Air780EU queries and parses the SIM-verified Vodacom prepaid data balance USSD', () => {
  assert.doesNotMatch(firmware, /cellQueryText\("AT\+CUSD=\?"/);
  assert.match(firmware, /Skipping unreliable AT\+CUSD=\? capability probe/);
  assert.match(firmware, /AT\+CUSD=1,/);
  assert.match(firmware, /DEFAULT_PREPAID_BALANCE_USSD = "\*111\*502#"/);
  assert.match(firmware, /RETIRED_PREPAID_BALANCE_USSD = "\*135\*500#"/);
  assert.match(firmware, /balanceUssdCode != RETIRED_PREPAID_BALANCE_USSD/);
  assert.match(prepaidUssdMigration, /set default '\*111\*502#'/);
  assert.match(prepaidUssdMigration, /set ussd_code = '\*111\*502#'/);
  assert.match(configFunction, /ussd_code: prepaidBalance\?\.ussd_code \?\? '\*111\*502#'/);
  assert.match(deviceManagement, /queries this Vodacom SIM with \*111\*502#/);
  assert.match(firmware, /VODACOM_USSD_TIMEOUT_MS = 45000UL/);
  assert.match(firmware, /parseDataBalanceBytes/);
  assert.match(firmware, /decodeUcs2Hex/);
  assert.match(firmware, /prepaidBalanceCheckIntervalMinutes/);
  assert.match(firmware, /addPrepaidBalanceMetadata/);
  assert.match(firmware, /balance\["report_pending"\] = prepaidBalanceReportPending/);
  assert.match(firmware, /VODACOM BALANCE/);
});

test('manual Vodacom balance query registers the cellular modem on demand', () => {
  const commandStart = firmware.indexOf('if (line.equalsIgnoreCase("VODACOM BALANCE"))');
  const commandEnd = firmware.indexOf('if (line.equalsIgnoreCase("DATA USAGE"))', commandStart);
  const commandBody = firmware.slice(commandStart, commandEnd);

  assert.ok(commandStart >= 0);
  assert.ok(commandEnd > commandStart);
  assert.match(commandBody, /if \(!cellReady\)/);
  assert.match(commandBody, /cellReady = initializeCellular\(\)/);
  assert.match(commandBody, /Air780EU registered; starting the Vodacom balance query/);
  assert.match(commandBody, /queryVodacomPrepaidBalance\(\)/);
  assert.match(commandBody, /prepaidBalanceStatus = "modem_not_registered"/);
  assert.doesNotMatch(commandBody, /requires a registered cellular modem/);
});
