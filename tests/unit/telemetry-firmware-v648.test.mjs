import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformTelemetryV648 } from '../../scripts/generate-telemetry-v6-8-48.mjs';

const source = await readFile(new URL('../../firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino', import.meta.url), 'utf8');
const firmware = transformTelemetryV648(source);

test('V6.8.48 consumes remote MDB pin-order configuration and persists it', () => {
  assert.match(firmware, /6\.8\.48-esp32s3-air780eu-remote-mdb-pin-order/);
  assert.match(firmware, /bool mdbPinSwap;/);
  assert.match(firmware, /mdbControl\["swap_pins"\]/);
  assert.match(firmware, /prefs\.putBool\("mdb_swap", policy\.mdbPinSwap\)/);
  assert.match(firmware, /prefs\.getBool\("mdb_swap", policy\.mdbPinSwap\)/);
});

test('V6.8.48 maps logical Master-TX and Master-RX onto either GPIO order', () => {
  assert.match(firmware, /return policy\.mdbPinSwap \? MDB_VMC_RX_MONITOR_PIN : MDB_VMC_TX_MONITOR_PIN/);
  assert.match(firmware, /return policy\.mdbPinSwap \? MDB_VMC_TX_MONITOR_PIN : MDB_VMC_RX_MONITOR_PIN/);
  assert.match(firmware, /rmtReadAsync\(mdbMasterMonitorPin\(\)/);
  assert.match(firmware, /rmtReadAsync\(mdbSlaveMonitorPin\(\)/);
  assert.match(firmware, /rmtReceiveCompleted\(mdbMasterMonitorPin\(\)\)/);
  assert.match(firmware, /rmtReceiveCompleted\(mdbSlaveMonitorPin\(\)\)/);
  assert.doesNotMatch(firmware, /rmtReadAsync\(MDB_VMC_TX_MONITOR_PIN/);
  assert.doesNotMatch(firmware, /rmtReadAsync\(MDB_VMC_RX_MONITOR_PIN/);
});

test('V6.8.48 remaps MDB by restarting only passive capture and retains input-only safety', () => {
  const applyStart = firmware.indexOf('bool applyConfiguredMdbPinSwap(');
  const applyEnd = firmware.indexOf('\n}', applyStart) + 2;
  const applyBody = firmware.slice(applyStart, applyEnd);
  assert.match(applyBody, /stopMdbCapture\(\)/);
  assert.match(applyBody, /beginMdbCapture\(\)/);
  assert.doesNotMatch(applyBody, /startCellularPpp|stopCellularPpp|WiFi\.|pinMode\([^,]+,\s*OUTPUT/);
  assert.match(firmware, /pinMode\(MDB_VMC_TX_MONITOR_PIN, INPUT\)/);
  assert.match(firmware, /pinMode\(MDB_VMC_RX_MONITOR_PIN, INPUT\)/);
  assert.match(firmware, /#define DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/);
  assert.match(firmware, /#error "Active MDB bus driving is intentionally not supported/);
});

test('V6.8.48 acknowledges the actual applied MDB configuration', () => {
  assert.match(firmware, /applied\["mdb_master_tx_polarity"\] = policy\.mdbMasterPolarity/);
  assert.match(firmware, /applied\["mdb_slave_rx_polarity"\] = policy\.mdbSlavePolarity/);
  assert.match(firmware, /applied\["mdb_pin_swap"\] = policy\.mdbPinSwap/);
  assert.match(firmware, /applied\["mdb_master_tx_gpio"\] = mdbMasterMonitorPin\(\)/);
  assert.match(firmware, /applied\["mdb_slave_rx_gpio"\] = mdbSlaveMonitorPin\(\)/);
  assert.match(firmware, /applied\["mdb_passive_input_only"\] = true/);
});

test('V6.8.48 keeps reporting mode, transport preference and polarity controls intact', () => {
  assert.match(firmware, /copyText\(policy\.mode, sizeof\(policy\.mode\), p\["mode"\] \| "live"\)/);
  assert.match(firmware, /control\["transport_preference"\] \| "auto"/);
  assert.match(firmware, /control\["wifi_enabled"\] \| true/);
  assert.match(firmware, /control\["cellular_enabled"\] \| true/);
  assert.match(firmware, /mdbControl\["master_tx_polarity"\] \| "auto"/);
  assert.match(firmware, /mdbControl\["slave_rx_polarity"\] \| "auto"/);
  assert.match(firmware, /applyConfiguredMdbPolarity\(true, mdbPinOrderApplied\)/);
});
