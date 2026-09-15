import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'hardware/telemetry-rev-b/safety-contract.json'), 'utf8'));
const design = fs.readFileSync(path.join(root, 'hardware/telemetry-rev-b/mdb-sense-evt-daughterboard.md'), 'utf8');
const bom = fs.readFileSync(path.join(root, 'hardware/telemetry-rev-b/mdb-sense-evt-daughterboard-bom.csv'), 'utf8');
const netlist = fs.readFileSync(path.join(root, 'hardware/telemetry-rev-b/mdb-sense-evt-daughterboard-netlist.csv'), 'utf8');
const results = fs.readFileSync(path.join(root, 'hardware/telemetry-rev-b/mdb-sense-evt-results-template.csv'), 'utf8');
const errors = [];

const requireCondition = (condition, message) => {
  if (!condition) errors.push(message);
};

const fixture = contract.validation_fixture ?? {};
requireCondition(fixture.name === 'MDB-SENSE-EVT-A', 'unexpected MDB validation fixture name');
requireCondition(fixture.bench_only === true, 'MDB sensing daughterboard must remain bench-only');
requireCondition(fixture.live_machine_use_allowed === false, 'MDB sensing daughterboard must not be approved for live-machine use');
requireCondition(fixture.includes_mdb_pin1_power === false, 'MDB sensing daughterboard must not expose MDB pin 1 / +34V');
requireCondition(fixture.includes_mdb_pin2_power_return === false, 'MDB sensing daughterboard must not expose MDB pin 2 power return');
requireCondition(fixture.includes_mdb_pin3 === false, 'MDB sensing daughterboard must not expose MDB pin 3');
requireCondition(fixture.raw_protection_population_default === 'DNI/TBD', 'raw-line protection must remain DNI/TBD on the first fixture population');
requireCondition(fixture.optional_input_caps_default === 'DNI', 'optional MDB input capacitors must default to DNI');
requireCondition(fixture.daughterboard_bom_present === true, 'daughterboard BOM must remain part of the validation package');
requireCondition(fixture.daughterboard_netlist_present === true, 'daughterboard netlist must remain part of the validation package');
requireCondition(fixture.results_template_present === true, 'daughterboard results template must remain part of the validation package');

for (const requiredSignal of ['MDB_MASTER_TX_RAW', 'MDB_MASTER_RX_RAW', 'MDB_COMM_COMMON']) {
  requireCondition((fixture.mdb_external_signals ?? []).includes(requiredSignal), `fixture MDB connector missing ${requiredSignal}`);
}
for (const requiredSignal of ['ISO_5V_IN', 'LOGIC_GND', '3V3_LOGIC_IN', 'MDB_TX_MON_3V3', 'MDB_RX_MON_3V3']) {
  requireCondition((fixture.logic_external_signals ?? []).includes(requiredSignal), `fixture logic connector missing ${requiredSignal}`);
}

// The validation fixture deliberately has no machine-power rail. If either net
// appears in its connection table, the fixture has become unsafe for its stated
// purpose even if the prose still says otherwise.
requireCondition(!netlist.includes('MACH_34V_IN'), 'daughterboard netlist must not include machine +34V');
requireCondition(!netlist.includes('MACH_PWR_RETURN'), 'daughterboard netlist must not include machine power return');
requireCondition(!netlist.includes('MDB pin1'), 'daughterboard netlist must not define MDB pin1');
requireCondition(!netlist.includes('MDB pin2'), 'daughterboard netlist must not define MDB pin2');

for (const requiredConnection of [
  'ISO_5V_IN,J_LOGIC_TEST pin1,PS_MDB VIN+,LOGIC',
  'LOGIC_GND,J_LOGIC_TEST pin2,PS_MDB VIN-,LOGIC',
  '3V3_LOGIC_IN,J_LOGIC_TEST pin3,U_ISO VCC2,LOGIC',
  'MDB_TX_MON_3V3,J_LOGIC_TEST pin4,U_ISO OUT_A,LOGIC',
  'MDB_RX_MON_3V3,J_LOGIC_TEST pin5,U_ISO OUT_B,LOGIC',
  'MDB_MASTER_TX_RAW,J_MDB_TEST pin1,R_TX_SER pin1,MDB_SENSE',
  'MDB_MASTER_RX_RAW,J_MDB_TEST pin2,R_RX_SER pin1,MDB_SENSE',
  'MDB_COMM_COMMON,J_MDB_TEST pin3,PS_MDB VOUT-,MDB_SENSE',
  'MDB_SENSE_5V,PS_MDB VOUT+,U_CMP VCC,MDB_SENSE',
  'MDB_TX_SENSE_LOGIC,U_CMP OUTA,U_ISO IN_A,MDB_SENSE',
  'MDB_RX_SENSE_LOGIC,U_CMP OUTB,U_ISO IN_B,MDB_SENSE',
]) {
  requireCondition(netlist.includes(requiredConnection), `daughterboard netlist missing: ${requiredConnection}`);
}

requireCondition(!netlist.includes('MDB_COMM_COMMON,J_LOGIC_TEST'), 'MDB communications common must not enter the logic connector');
requireCondition(!netlist.includes('LOGIC_GND,J_MDB_TEST'), 'logic ground must not enter the MDB/simulator connector');
requireCondition(!netlist.includes('MDB_MASTER_TX_RAW,J_LOGIC_TEST'), 'raw Master-TX must not enter the logic connector');
requireCondition(!netlist.includes('MDB_MASTER_RX_RAW,J_LOGIC_TEST'), 'raw Master-RX must not enter the logic connector');

for (const requiredBomEntry of [
  'PS_MDB,Regulated isolated MDB sense supply,NXF1S0505MC',
  'U_CMP,Dual MDB comparator,TLV3202-Q1',
  'U_ISO,Dual machine-to-logic digital isolator,ISO7720',
  'R_TX_SER,Master-TX raw series resistor,100k 1%',
  'R_RX_SER,Master-RX raw series resistor,100k 1%',
  'R_HYS_A,Master-TX positive feedback,2.2M 1%',
  'R_HYS_B,Master-RX positive feedback,2.2M 1%',
]) {
  requireCondition(bom.includes(requiredBomEntry), `daughterboard BOM missing: ${requiredBomEntry}`);
}
requireCondition(bom.includes('C_TX_IN,Optional Master-TX raw filter,10pF C0G/NP0,TBD,DNI'), 'TX input filter must remain DNI');
requireCondition(bom.includes('C_RX_IN,Optional Master-RX raw filter,10pF C0G/NP0,TBD,DNI'), 'RX input filter must remain DNI');
requireCondition(bom.includes('D_TX_PROTECT') && bom.includes('DNI/TBD'), 'TX raw protection must remain unpopulated/TBD');
requireCondition(bom.includes('D_RX_PROTECT') && bom.includes('DNI/TBD'), 'RX raw protection must remain unpopulated/TBD');

requireCondition(design.includes('MDB pins 1 (+34 V), 2 (Power Return) and 3 (N/C) do not exist'), 'daughterboard design must explicitly exclude MDB power pins');
requireCondition(design.includes('Do not connect `LOGIC_GND` to `MDB_COMM_COMMON`'), 'daughterboard design must prohibit ground bridging');
requireCondition(design.includes('MDB simulator / isolated bench source first'), 'daughterboard design must require simulator/bench validation first');

for (const testId of ['MDB-ISO-01', 'MDB-ISO-02', 'MDB-PWR-01', 'MDB-TH-05', 'MDB-LD-02', 'MDB-LD-06', 'MDB-TM-01', 'MDB-TM-02', 'MDB-DP-01', 'MDB-ISO-04']) {
  requireCondition(results.includes(testId), `daughterboard results template missing ${testId}`);
}

requireCondition(contract.field_use_allowed === false, 'full Rev-B field-use flag must remain false while daughterboard validation is pending');
requireCondition(contract.manufacturing_release_allowed === false, 'full Rev-B manufacturing-release flag must remain false while daughterboard validation is pending');

if (errors.length) {
  console.error('MDB-SENSE-EVT-A fixture check failed:');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('MDB-SENSE-EVT-A fixture safety contract passed.');
console.log('Bench/simulator use only; no MDB power pins; no live-machine approval.');
