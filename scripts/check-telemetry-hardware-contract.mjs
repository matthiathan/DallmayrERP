import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'hardware/telemetry-rev-b/safety-contract.json');
const schematicDefinitionPath = path.join(root, 'hardware/telemetry-rev-b/schematic-definition.md');
const powerIntegrationPath = path.join(root, 'hardware/telemetry-rev-b/power-module-integration.md');
const dexIntegrationPath = path.join(root, 'hardware/telemetry-rev-b/dex-interface-integration.md');
const cadConnectionsPath = path.join(root, 'hardware/telemetry-rev-b/cad-connections.csv');
const firmwarePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const schematicDefinition = fs.readFileSync(schematicDefinitionPath, 'utf8');
const powerIntegration = fs.readFileSync(powerIntegrationPath, 'utf8');
const dexIntegration = fs.readFileSync(dexIntegrationPath, 'utf8');
const cadConnections = fs.readFileSync(cadConnectionsPath, 'utf8');
const firmware = fs.readFileSync(firmwarePath, 'utf8');
const errors = [];

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

requireCondition(contract.schema_version === 3, 'hardware contract schema_version must be 3');
requireCondition(contract.hardware_revision === 'telemetry-rev-b-isolated', 'unexpected hardware revision');
requireCondition(contract.status === 'cad-input-definition', 'Rev-B contract must remain in CAD-input definition state');

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
requireCondition(components.isolated_power?.part === 'UEI15-050-Q48N-C', 'PS1 CAD candidate must remain UEI15-050-Q48N-C until EVT review');
requireCondition(components.isolated_power?.recommended_fast_blow_fuse_a === 2, 'PS1 candidate must preserve the 2 A manufacturer-recommended fast-blow fuse input');
requireCondition(components.isolated_power?.remote_logic === 'negative', 'PS1 N-suffix remote logic must remain negative');
requireCondition(components.isolated_dex?.direct_esp32_connection_allowed === false, 'ADM3251E-class DEX logic must never connect directly to ESP32 GPIO');
requireCondition(components.dex_up_translation?.part === 'SN74AHCT1G125', 'DEX 3.3V->5V validation candidate must remain SN74AHCT1G125 until schematic review');
requireCondition(components.dex_down_translation?.part === 'SN74LVC1G17', 'DEX 5V->3.3V validation candidate must remain SN74LVC1G17 until schematic review');

requireCondition(schematicDefinition.includes('No optocoupler LED resistor, comparator threshold, pull-up or clamp values are frozen'), 'schematic definition must keep MDB sensing values in validation state');
requireCondition(powerIntegration.includes('pin 6 REMOTE_ON_OFF'), 'power CAD input must define PS1 remote-control handling');
requireCondition(powerIntegration.includes('2 A fast-blow'), 'power CAD input must preserve the UEI15 family fuse recommendation');
requireCondition(powerIntegration.includes('6.3 mm'), 'power CAD input must preserve the Murata primary/secondary barrier guidance');
requireCondition(dexIntegration.includes('SN74AHCT1G125'), 'DEX CAD input must include the 3.3V->5V translator');
requireCondition(dexIntegration.includes('SN74LVC1G17'), 'DEX CAD input must include the 5V->3.3V translator');
requireCondition(dexIntegration.includes('C_DEX_VISO'), 'DEX CAD input must include isolated-side VISO bypass');
requireCondition(dexIntegration.includes('0.1 uF, >=16 V, between pin 18'), 'DEX CAD input must define the C1 charge-pump capacitor');

const cad = contract.cad_inputs ?? {};
requireCondition(cad.ps1_pinout_verified_against_family_datasheet === true, 'PS1 pinout must remain marked datasheet-verified');
requireCondition(cad.ps1_recommended_fast_blow_fuse_a === 2, 'CAD contract must retain PS1 2 A fast-blow recommendation');
requireCondition(cad.ps1_recommended_primary_secondary_barrier_mm >= 6.3, 'CAD contract must retain at least the 6.3 mm PS1 barrier guidance');
requireCondition(cad.ps1_default_remote_connection === 'pin6_to_pin2_via_0ohm', 'PS1 N-suffix default remote connection must remain primary-side pin6-to-pin2');
requireCondition(cad.adm3251e_pinout_verified_against_current_datasheet === true, 'ADM3251E pinout must remain marked datasheet-verified');
requireCondition(cad.adm3251e_charge_pump_capacitance_uf === 0.1, 'ADM3251E charge-pump capacitance CAD input must remain 0.1uF');
requireCondition(cad.adm3251e_viso_external_load_allowed === false, 'ADM3251E VISO must not be exposed as an external power source');
requireCondition(cad.cad_connection_table_present === true, 'CAD connection table must remain required');

for (const connection of [
  'PS1,1 +VIN,PS1_VIN_PROTECTED,MACHINE',
  'PS1,2 -VIN,MACH_PWR_RETURN,MACHINE',
  'PS1,3 +VOUT,ISO_5V,LOGIC',
  'PS1,5 -VOUT,LOGIC_GND,LOGIC',
  'U_DEX,8 ROUT,DEX_RX_5V,LOGIC',
  'U_DEX,9 TIN,DEX_TX_5V,LOGIC',
  'U_DEX,11 GNDISO,DEX_ISO_GND,DEX_ISOLATED',
  'U_DEX_UP,Y,DEX_TX_5V,LOGIC',
  'U_DEX_DOWN,Y,DEX_RX_3V3,LOGIC',
]) {
  requireCondition(cadConnections.includes(connection), `CAD connection table missing required connection: ${connection}`);
}

requireCondition(!cadConnections.includes('U_DEX,8 ROUT,DEX_RX_3V3'), 'ADM3251E ROUT must not connect directly to ESP32 3.3V receive net');
requireCondition(!cadConnections.includes('U_DEX,9 TIN,DEX_TX_3V3'), 'ESP32 3.3V transmit net must not connect directly to ADM3251E TIN');

const schematicState = contract.schematic_state ?? {};
requireCondition(schematicState.mdb_master_tx_sensing_values === 'validation', 'MDB Master-TX sensing values must remain validation-only until bench data exists');
requireCondition(schematicState.mdb_master_rx_sensing_values === 'validation', 'MDB Master-RX sensing values must remain validation-only until bench data exists');
requireCondition(schematicState.input_protection_values === 'validation', 'surge/reverse/filter values must remain validation-only until source/inrush data exists');
requireCondition(schematicState.pcb_outline === 'not_locked', 'PCB outline must not be locked before isolation/layout validation');

const gates = Object.values(contract.release_gates ?? {});
const allReleaseGatesPassed = gates.length > 0 && gates.every(Boolean);
requireCondition(
  contract.field_use_allowed === allReleaseGatesPassed,
  'field_use_allowed may only become true when every release gate is true',
);
requireCondition(
  contract.manufacturing_release_allowed === false,
  'manufacturing_release_allowed must remain false during CAD-input definition',
);

if (errors.length) {
  console.error('Telemetry hardware contract check failed:');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('Telemetry Rev-B hardware contract passed.');
console.log(`Field use allowed: ${contract.field_use_allowed ? 'YES' : 'NO - validation gates remain open'}`);
console.log(`Manufacturing release allowed: ${contract.manufacturing_release_allowed ? 'YES' : 'NO - CAD/bench validation not complete'}`);
