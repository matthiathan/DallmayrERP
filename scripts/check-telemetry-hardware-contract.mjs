import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'hardware/telemetry-rev-b/safety-contract.json');
const schematicDefinitionPath = path.join(root, 'hardware/telemetry-rev-b/schematic-definition.md');
const firmwarePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const schematicDefinition = fs.readFileSync(schematicDefinitionPath, 'utf8');
const firmware = fs.readFileSync(firmwarePath, 'utf8');
const errors = [];

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

requireCondition(contract.schema_version === 2, 'hardware contract schema_version must be 2');
requireCondition(contract.hardware_revision === 'telemetry-rev-b-isolated', 'unexpected hardware revision');
requireCondition(contract.status === 'pre-cad-schematic-definition', 'Rev-B contract must remain in pre-CAD schematic definition state');

const supply = contract.machine_supply ?? {};
requireCondition(supply.converter_min_input_vdc <= 20, 'isolated converter must cover the 20 V MDB minimum');
requireCondition(supply.converter_max_input_vdc >= 75, 'isolated converter input maximum must be at least 75 V');
requireCondition(supply.high_line_peak_vdc >= 45, 'contract must account for the MDB high-line peak');
requireCondition(supply.minimum_output_current_a >= 3, 'Rev-B isolated 5 V supply must budget at least 3 A');
requireCondition(supply.minimum_output_power_w >= 15, 'Rev-B isolated power budget must be at least 15 W');
requireCondition(supply.minimum_isolation_vdc >= 1500, 'main DC/DC isolation requirement must be at least 1.5 kVDC');

const requiredBlocks = new Set(contract.required_blocks ?? []);
for (const required of [
  'input_fuse_or_ptc',
  'reverse_polarity_protection',
  'surge_transient_protection',
  'isolated_18_75v_to_5v_power',
  'isolated_passive_mdb_master_tx_receiver',
  'isolated_passive_mdb_master_rx_receiver',
  'isolated_rs232_dex_interface',
  'dex_3v3_to_5v_logic_translation',
  'dex_5v_to_3v3_logic_translation',
]) {
  requireCondition(requiredBlocks.has(required), `missing required hardware block: ${required}`);
}

const machineNets = new Set(contract.machine_domain_nets ?? []);
const logicNets = new Set(contract.logic_domain_nets ?? []);
for (const [left, right] of contract.forbidden_direct_connections ?? []) {
  requireCondition(machineNets.has(left), `forbidden-connection machine net is not declared: ${left}`);
  requireCondition(logicNets.has(right), `forbidden-connection logic net is not declared: ${right}`);
}

for (const requiredPair of [
  ['MACH_PWR_RETURN', 'LOGIC_GND'],
  ['MACH_PWR_RETURN', 'USB_GND'],
  ['MDB_COMM_COMMON', 'LOGIC_GND'],
  ['MDB_COMM_COMMON', 'USB_GND'],
  ['DEX_RS232_COMMON', 'LOGIC_GND'],
  ['DEX_RS232_COMMON', 'USB_GND'],
  ['DEX_ISO_GND', 'LOGIC_GND'],
  ['DEX_ISO_GND', 'USB_GND'],
  ['MDB_MASTER_TX_RAW', 'GPIO4_MDB_MONITOR'],
  ['MDB_MASTER_RX_RAW', 'GPIO5_MDB_MONITOR'],
]) {
  const found = (contract.forbidden_direct_connections ?? [])
    .some(([left, right]) => left === requiredPair[0] && right === requiredPair[1]);
  requireCondition(found, `missing forbidden direct connection: ${requiredPair.join(' -> ')}`);
}

const pins = contract.firmware_pin_contract ?? {};
const pinContracts = [
  ['cell_rx_gpio', 1, 'static const int CELL_RX_PIN = 1;'],
  ['cell_tx_gpio', 2, 'static const int CELL_TX_PIN = 2;'],
  ['mdb_master_tx_monitor_gpio', 4, 'static const int MDB_VMC_TX_MONITOR_PIN = 4;'],
  ['mdb_master_rx_monitor_gpio', 5, 'static const int MDB_VMC_RX_MONITOR_PIN = 5;'],
  ['dex_rx_gpio', 17, 'static const int DEX_RX_PIN  = 17;'],
  ['dex_tx_gpio', 18, 'static const int DEX_TX_PIN  = 18;'],
];

for (const [key, expected, sourceNeedle] of pinContracts) {
  requireCondition(pins[key] === expected, `${key} must remain GPIO${expected}`);
  requireCondition(firmware.includes(sourceNeedle), `firmware pin contract drifted: ${sourceNeedle}`);
}

requireCondition(pins.mdb_active_tx_allowed === false, 'Rev-B must remain passive-only on MDB');
requireCondition(
  firmware.includes('#define DALLMAYR_MDB_ACTIVE_TX_ENABLED  false'),
  'firmware must keep DALLMAYR_MDB_ACTIVE_TX_ENABLED false',
);

const components = contract.candidate_components ?? {};
requireCondition(components.isolated_dex?.direct_esp32_connection_allowed === false, 'ADM3251E-class DEX logic must never connect directly to ESP32 GPIO');
requireCondition(components.dex_up_translation?.part === 'SN74AHCT1G125', 'DEX 3.3V->5V validation candidate must remain SN74AHCT1G125 until schematic review');
requireCondition(components.dex_down_translation?.part === 'SN74LVC1G17', 'DEX 5V->3.3V validation candidate must remain SN74LVC1G17 until schematic review');
requireCondition(schematicDefinition.includes('SN74AHCT1G125'), 'schematic definition must document the DEX up-translator');
requireCondition(schematicDefinition.includes('SN74LVC1G17'), 'schematic definition must document the DEX down-translator');
requireCondition(schematicDefinition.includes('No optocoupler LED resistor, comparator threshold, pull-up or clamp values are frozen'), 'schematic definition must keep MDB sensing values in validation state');

const schematicState = contract.schematic_state ?? {};
requireCondition(schematicState.mdb_master_tx_sensing_values === 'validation', 'MDB Master-TX sensing values must remain validation-only until bench data exists');
requireCondition(schematicState.mdb_master_rx_sensing_values === 'validation', 'MDB Master-RX sensing values must remain validation-only until bench data exists');
requireCondition(schematicState.pcb_outline === 'not_locked', 'PCB outline must not be locked before isolation/layout validation');

const gates = Object.values(contract.release_gates ?? {});
const allReleaseGatesPassed = gates.length > 0 && gates.every(Boolean);
requireCondition(
  contract.field_use_allowed === allReleaseGatesPassed,
  'field_use_allowed may only become true when every release gate is true',
);
requireCondition(
  contract.manufacturing_release_allowed === false,
  'manufacturing_release_allowed must remain false during pre-CAD schematic definition',
);

if (errors.length) {
  console.error('Telemetry hardware contract check failed:');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('Telemetry Rev-B hardware contract passed.');
console.log(`Field use allowed: ${contract.field_use_allowed ? 'YES' : 'NO - validation gates remain open'}`);
console.log(`Manufacturing release allowed: ${contract.manufacturing_release_allowed ? 'YES' : 'NO - schematic/layout validation not complete'}`);
