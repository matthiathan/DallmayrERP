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
const firmware = fs.readFileSync(new URL('../../firmware/DallmayrTelemetryV6_8_38/DallmayrTelemetryV6_8_38.ino', import.meta.url), 'utf8');

test('device configuration returns the verified Vodacom South Africa profile', () => {
  assert.match(configFunction, /carrier: 'Vodacom South Africa'/);
  assert.match(configFunction, /apn: 'internet'/);
  assert.match(configFunction, /username: 'guest'/);
  assert.match(configFunction, /authentication: 'pap'/);
  assert.match(configFunction, /mcc: '655'/);
  assert.match(configFunction, /mnc: '01'/);
});

test('telemetry management refreshes active transport and usage without manual reload', () => {
  assert.match(deviceManagement, /window\.setInterval\(refresh, 10000\)/);
  assert.match(deviceManagement, /document\.visibilityState !== 'visible'/);
  assert.match(deviceManagement, /loadDevices\(false\)/);
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
  assert.match(firmware, /6\.8\.38-esp32s3-air780eu-ussd-auto-register/);
  assert.match(firmware, /SIM DATA TEST/);
  assert.match(firmware, /sendCellularSimulationSnapshot/);
  assert.match(firmware, /pppHttpPost\(INGEST_URL/);
  assert.match(firmware, /"simulation_snapshot"/);
  assert.match(firmware, /application_tx_bytes_total/);
  assert.match(firmware, /application_rx_bytes_total/);
  assert.match(firmware, /String headers = "Authorization: Bearer " \+ supabaseAnonKey/);
  assert.match(firmware, /SUPABASE ANON KEY/);
  assert.match(firmware, /dailyUnits != 1 \|\| dailyRevenue != 1500/);
});

test('Air780EU startup recovers command mode after a failed or surviving PPP session', () => {
  assert.match(firmware, /bool recoverAir780CommandMode\(/);
  assert.match(firmware, /delay\(1200\)/);
  assert.match(firmware, /CellSerial\.print\("\+\+\+"\)/);
  assert.match(firmware, /delay\(700\)/);
  assert.match(firmware, /CellSerial\.print\("ATH\\r\\n"\)/);
  assert.match(firmware, /Air780EU command mode recovered/);
  assert.match(firmware, /if \(!recoverAir780CommandMode\(true\)\) return false/);
  assert.match(firmware, /CELL PPP ESCAPE/);
});

test('manual PPP raw API is protected by the ESP-IDF TCPIP core lock', () => {
  assert.match(firmware, /#include "lwip\/tcpip\.h"/);
  assert.match(firmware, /Creating persistent lwIP PPPoS control block under TCP\/IP core lock/);
  assert.match(firmware, /LOCK_TCPIP_CORE\(\)[\s\S]*pppos_create\(/);
  assert.match(firmware, /LOCK_TCPIP_CORE\(\)[\s\S]*ppp_connect\(airPppPcb, 0\)/);
  assert.match(firmware, /LOCK_TCPIP_CORE\(\)[\s\S]*ppp_close\(airPppPcb, 1\)/);
  assert.match(firmware, /airPppIpAddress\[0\] != '\\0'/);
});

test('Vodacom PPP starts with the proven blank PAP profile and retains guest fallback', () => {
  assert.match(firmware, /VODACOM_PPP_USERNAME_BLANK = ""/);
  assert.match(firmware, /VODACOM_PPP_USERNAME_GUEST = "guest"/);
  assert.match(firmware, /VODACOM_PPP_PASSWORD = ""/);
  assert.match(firmware, /airPppAuthProfileIndex = 0/);
  assert.match(firmware, /ppp_set_auth\(/);
  assert.match(firmware, /PPPAUTHTYPE_PAP/);
  assert.match(firmware, /PPP PAP blank\/blank was rejected; next retry will use guest\/blank/);
  assert.match(firmware, /PPP PAP guest\/blank was also rejected/);
  assert.match(firmware, /ppp_set_notify_phase_callback/);
  assert.match(firmware, /AUTHENTICATE\/PAP/);
  assert.match(firmware, /NETWORK\/IPCP/);
});

test('PPP retries reuse one control block instead of recreating the lwIP netif', () => {
  assert.match(firmware, /bool ensureAirPppControlBlock\(/);
  assert.match(firmware, /airPppControlBlockReady/);
  assert.match(firmware, /reusable control block retained/);
  assert.doesNotMatch(firmware, /ppp_free\(/);
  assert.match(firmware, /closeAirPppSession\(/);
  assert.match(firmware, /ppp_close\(airPppPcb, 1\)/);
});

test('production PPP bootstrap traces control frames and snapshots negotiation state', () => {
  assert.match(firmware, /struct AirPppTraceState/);
  assert.match(firmware, /traceAirPppBytes\(airPppTxTrace, "TX"/);
  assert.match(firmware, /traceAirPppBytes\(airPppRxTrace, "RX"/);
  assert.match(firmware, /traceAirPppIpcpOptions/);
  assert.match(firmware, /protocol == 0x8021/);
  assert.match(firmware, /\[PPP SNAPSHOT\]/);
  assert.match(firmware, /ipcp_gotoptions\.ouraddr/);
});

test('Air780EU V1180 production firmware does not execute unsupported USSD balance commands', () => {
  assert.doesNotMatch(firmware, /cellCommand\("AT\+CUSD/);
  assert.doesNotMatch(firmware, /CellSerial\.print\("AT\+CUSD/);
  assert.match(firmware, /unsupported_modem_firmware/);
  assert.match(firmware, /Vodacom prepaid balance unavailable on Air780EU V1180/);
});

test('Supabase gateway credential has a compile-time fallback and is seeded into NVS', () => {
  assert.match(firmware, /#define DALLMAYR_SUPABASE_ANON_KEY\s+"eyJ/);
  assert.match(firmware, /storedSupabaseAnonKey/);
  assert.match(firmware, /seedSupabaseAnonKey/);
  assert.match(firmware, /Supabase gateway JWT seeded into NVS from firmware fallback/);
  assert.match(firmware, /gatewayCredentialReady/);
  assert.match(firmware, /bool wifiReady\(\);/);
});

test('cellular-preferred boot isolates the first PPP handshake from Wi-Fi and machine services', () => {
  assert.match(firmware, /Cellular-preferred isolated bootstrap/);
  assert.match(firmware, /WiFi\.mode\(WIFI_OFF\)/);
  assert.match(firmware, /bootstrapRegistered && startCellularPpp\(\)/);
  assert.match(firmware, /Start machine services only after the isolated cellular bootstrap window/);
  assert.match(firmware, /cellCommand\("AT\+CSCLK=0"/);
  assert.match(firmware, /vTaskDelay\(pdMS_TO_TICKS\(1\)\)/);

  const setupStart = firmware.indexOf('void setup()');
  const setupEnd = firmware.indexOf('void loop()', setupStart);
  const setupBody = firmware.slice(setupStart, setupEnd);
  assert.ok(setupBody.indexOf('startCellularPpp()') < setupBody.indexOf('restartMachineInterface()'));
});

test('production PPP startup matches the successful isolated diagnostic sequence', () => {
  assert.doesNotMatch(firmware, /AT\+SAPBR=0,1/);
  assert.match(firmware, /"air780_ppp_rx",\s*6144/);
  assert.match(firmware, /matching the successful V6\.8\.31 diagnostic sequence[\s\S]*delay\(20\)/);
  assert.match(firmware, /after 5 probes/);
  assert.match(firmware, /AT\+CSCLK=0/);

  const initStart = firmware.indexOf('bool initializeCellular()');
  const initEnd = firmware.indexOf('const char* airPppAuthUsername()', initStart);
  const initBody = firmware.slice(initStart, initEnd);
  assert.doesNotMatch(initBody, /enableCellModemDataUsage\(\)/);
});

test('production PPP uses the V6.8.31 verified Vodacom IPCP profile', () => {
  assert.match(firmware, /PPP_CONNECT_TIMEOUT_MS = 120000UL/);
  assert.match(firmware, /Network\.begin\(\)/);
  assert.match(firmware, /applyVerifiedAirPppNegotiationProfileLocked/);
  assert.match(firmware, /ipcp_wantoptions\.accept_local = 1/);
  assert.match(firmware, /ipcp_wantoptions\.accept_remote = 1/);
  assert.match(firmware, /ipcp_wantoptions\.neg_vj = 0/);
  assert.match(firmware, /memset\(&airPppPcb->ccp_wantoptions/);
  assert.match(firmware, /PPP CID1 APN already correct; preserving active PDP state/);
  assert.match(firmware, /activeStatus\.indexOf\("\+CGACT: 1,1"\) >= 0/);
  assert.match(firmware, /verified V6\.8\.31 profile/);
});

test('Air780EU manual PPPoS handoff preserves active CID1 and dials without esp-modem', () => {
  assert.match(firmware, /PPP CID1 APN already correct; preserving active PDP state/);
  assert.match(firmware, /activeStatus\.indexOf\("\+CGACT: 1,1"\) >= 0/);
  assert.match(firmware, /AT\+CGDCONT=1,\\"IP\\",\\"/);
  assert.match(firmware, /CellSerial\.print\("ATD\*99#\\r"\)/);
  assert.match(firmware, /pppos_create\(/);
  assert.match(firmware, /pppos_input_tcpip\(/);
  assert.match(firmware, /ppp_connect\(airPppPcb, 0\)/);
  assert.match(firmware, /ppp_set_usepeerdns\(airPppPcb, 1\)/);
  assert.match(firmware, /xTaskCreatePinnedToCore\(/);
  assert.doesNotMatch(firmware, /PPP\.begin\(/);
  assert.doesNotMatch(firmware, /PPP\.mode\(/);
  assert.doesNotMatch(firmware, /PPP\.cmd\(/);
});

test('production cellular telemetry bypasses Air780EU TLS and uses ESP32 manual PPPoS', () => {
  assert.match(firmware, /#include "netif\/ppp\/pppos\.h"/);
  assert.match(firmware, /bool pppHttpPost\(/);
  assert.match(firmware, /NetworkClientSecure tls/);
  assert.match(firmware, /recordApplicationTransfer\("cellular"/);
  assert.match(firmware, /: pppHttpPost\(INGEST_URL, payload, body, status\)/);
  assert.match(firmware, /pppOnline && pppHttpPost\(ENROLL_URL/);
  assert.match(firmware, /netif_set_default\(nif\)/);

  const legacyStart = firmware.indexOf('bool airHttpPost(');
  const legacyEnd = firmware.indexOf('// -----------------------------------------------------------------------------\n// GNSS / GPS', legacyStart);
  assert.ok(legacyStart >= 0 && legacyEnd > legacyStart);
  const productionWithoutLegacy = firmware.slice(0, legacyStart) + firmware.slice(legacyEnd);
  assert.doesNotMatch(productionWithoutLegacy, /airHttpPost\(/);
});


test('legacy Air780EU modem HTTP diagnostics remain available but isolated from production telemetry', () => {
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
  assert.match(firmware, /#define DALLMAYR_SUPABASE_ANON_KEY\s+"eyJ/);
  assert.match(firmware, /AIR780_HTTP_TIMEOUT_SECONDS = 45/);
  assert.match(firmware, /AIR780_HTTP_ACTION_WAIT_MS/);
  assert.match(firmware, /AIR780_HTTP_POST_CHUNK_TIMEOUT_MS = 15000UL/);
  assert.match(firmware, /AT\+HTTPPARA=\\"TIMEOUT\\"," \+ String\(AIR780_HTTP_TIMEOUT_SECONDS\)/);
  assert.match(firmware, /CellSerial\.print\("AT\+HTTPDATA=/);
  assert.match(firmware, /CellSerial\.print\("AT\+HTTPACTION=1/);
  assert.match(firmware, /CellSerial\.print\("AT\+HTTPREAD/);
  assert.match(firmware, /readAir780StandardHttpAction/);
  assert.match(firmware, /Air780EU HTTPACTION status=/);
  assert.match(firmware, /HTTP service timed out before Supabase returned a response/);
  assert.doesNotMatch(firmware, /CellSerial\.print\("AT\+HTTPEXACTION=1,/);
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
  assert.match(firmware, /readAir780StandardHttpAction\(/);
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

test('Air780EU V1180 reports prepaid balance as unsupported without executing USSD', () => {
  assert.doesNotMatch(firmware, /cellCommand\("AT\+CUSD/);
  assert.doesNotMatch(firmware, /CellSerial\.print\("AT\+CUSD/);
  assert.match(firmware, /unsupported_modem_firmware/);
  assert.match(firmware, /Air780EU V1180 AT firmware does not support the required USSD balance query/);
  assert.match(firmware, /prepaidBalanceCheckIntervalMinutes/);
  assert.match(firmware, /addPrepaidBalanceMetadata/);
  assert.match(firmware, /balance\["report_pending"\] = prepaidBalanceReportPending/);
  assert.match(firmware, /VODACOM BALANCE/);
});

test('manual Vodacom balance command is non-disruptive while PPP is running', () => {
  const commandStart = firmware.indexOf('if (line.equalsIgnoreCase("VODACOM BALANCE"))');
  const commandEnd = firmware.indexOf('if (line.equalsIgnoreCase("DATA USAGE"))', commandStart);
  const commandBody = firmware.slice(commandStart, commandEnd);

  assert.ok(commandStart >= 0);
  assert.ok(commandEnd > commandStart);
  assert.match(commandBody, /queryVodacomPrepaidBalance\(\)/);
  assert.doesNotMatch(commandBody, /stopCellularPpp/);
  assert.doesNotMatch(commandBody, /initializeCellular\(\)/);
  assert.doesNotMatch(commandBody, /CellSerial/);
});
