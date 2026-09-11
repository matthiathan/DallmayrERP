import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile(new URL('../../components/telemetry-platform/TelemetryDevicesWorkspace.tsx', import.meta.url), 'utf8');

test('device management paginates fleet-sized Supabase rowsets', () => {
  assert.match(workspace, /collectSupabasePagesResult/);
  assert.match(workspace, /from\('telemetry_devices'\)[\s\S]*?\.range\(from, to\)/);
  assert.match(workspace, /rpc\('get_telemetry_data_usage', \{ p_days: 30 \}\)\.range\(from, to\)/);
  assert.match(workspace, /rpc\('get_telemetry_prepaid_balances'\)\.range\(from, to\)/);

  assert.doesNotMatch(workspace, /client\.from\('telemetry_devices'\)\.select\(DEVICE_SELECT\)\.order\('device_code'\),/);
  assert.doesNotMatch(workspace, /client\.rpc\('get_telemetry_data_usage', \{ p_days: 30 \}\),/);
  assert.doesNotMatch(workspace, /client\.rpc\('get_telemetry_prepaid_balances'\),/);
});

test('device management batches linked-machine hydration instead of sending one fleet-sized IN filter', () => {
  assert.match(workspace, /const MACHINE_LOOKUP_BATCH_SIZE = 100;/);
  assert.match(workspace, /start \+= MACHINE_LOOKUP_BATCH_SIZE/);
  assert.match(workspace, /machineIds\.slice\(start, start \+ MACHINE_LOOKUP_BATCH_SIZE\)/);
  assert.match(workspace, /Promise\.all\(machineBatches\.map/);
  assert.match(workspace, /\.select\(MACHINE_SELECT\)\.in\('id', ids\)/);
  assert.doesNotMatch(workspace, /\.in\('id', machineIds\)/);
});

test('device management fails closed on partial fleet reads', () => {
  assert.match(workspace, /if \(deviceQuery\.error\)/);
  assert.match(workspace, /setUsage\(Object\.fromEntries\(\(usageQuery\.error \? \[\] : usageQuery\.data\)/);
  assert.match(workspace, /setPrepaid\(Object\.fromEntries\(\(prepaidQuery\.error \? \[\] : prepaidQuery\.data\)/);
  assert.match(workspace, /if \(firstMachineError\)[\s\S]*?setMachines\(\{\}\)/);
});
