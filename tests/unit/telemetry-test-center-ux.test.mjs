import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workspace = fs.readFileSync(new URL('../../components/features/TelemetryTestCenter.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../components/features/TelemetryTestCenter.module.css', import.meta.url), 'utf8');

test('Test Center exposes the complete remote session state journey', () => {
  for (const label of ['Connecting', 'Device acknowledged', 'Streaming', 'Stale', 'Ended']) {
    assert.match(workspace, new RegExp(label, 'i'));
  }
  assert.match(workspace, /last_log_at/);
  assert.match(workspace, /last_device_contact_at/);
  assert.match(workspace, /deriveJourneyState/);
});

test('Test Center supports searchable categorized logs and important event highlighting', () => {
  for (const label of ['MDB', 'DEX', 'Vend', 'Fault', 'Modem', 'Network', 'System']) {
    assert.match(workspace, new RegExp(`label: '${label}'`));
  }
  assert.match(workspace, /Search Test Center logs/);
  assert.match(workspace, /logTags/);
  assert.match(workspace, /importantLogKind/);
  assert.match(styles, /\.importantVend/);
  assert.match(styles, /\.importantFault/);
  assert.match(styles, /\.importantIdentity/);
});

test('Test Center exposes device decoder, protocol, pin-order and polarity context', () => {
  assert.match(workspace, /profile_assignment_method/);
  assert.match(workspace, /reported_machine_interface/);
  assert.match(workspace, /reported_machine_model/);
  assert.match(workspace, /mdb_pin_swap/);
  assert.match(workspace, /mdb_master_polarity/);
  assert.match(workspace, /mdb_slave_polarity/);
  assert.match(workspace, /GPIO4 Master-TX · GPIO5 Master-RX/);
  assert.match(workspace, /GPIO5 Master-TX · GPIO4 Master-RX/);
  assert.match(workspace, /passive\/input-only/i);
});

test('Test Center provides session history, archived viewing and full diagnostic export', () => {
  assert.match(workspace, /Session history/);
  assert.match(workspace, /View session/);
  assert.match(workspace, /Archived session/);
  assert.match(workspace, /Back to live/);
  assert.match(workspace, /Export session/);
  assert.match(workspace, /Dallmayr Telemetry Test Center diagnostic export/);
  assert.match(workspace, /\.from\('telemetry_test_sessions'\)[\s\S]*\.limit\(12\)/);
});

test('Test Center shows command completion, failures and delayed device response while keeping the explicit command allowlist', () => {
  assert.match(workspace, /telemetry_test_commands/);
  assert.match(workspace, /response_note/);
  assert.match(workspace, /Delayed/);
  assert.match(workspace, /30 seconds/);
  assert.match(workspace, /rpc\('queue_telemetry_test_command'/);

  const allowlist = workspace.match(/const SAFE_COMMANDS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  for (const command of ['STATUS', 'MACHINE IDENTITY', 'CUP COUNTERS', 'DATA USAGE', 'CELL PPP STATUS', 'WIRING', 'HELP']) {
    assert.match(allowlist, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(allowlist, /AT\+CFUN|AT\+CUSD|AT\+HTTP|MODEM AT/i);
  assert.match(workspace, /No arbitrary AT commands or machine-control commands are exposed remotely/i);
});
