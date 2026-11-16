#!/usr/bin/env node
// Read-only runtime regional-isolation smoke test for an existing Supabase project.
// No credentials are committed; supply short-lived JWTs via environment variables.
// Use dedicated test accounts assigned to different telemetry regions.
import assert from 'node:assert/strict';

const required = [
  'SUPABASE_URL', 'SUPABASE_PUBLIC_KEY',
  'TELEMETRY_TEST_REGION_A_JWT', 'TELEMETRY_TEST_REGION_A',
  'TELEMETRY_TEST_REGION_B_JWT', 'TELEMETRY_TEST_REGION_B',
  'TELEMETRY_TEST_NONADMIN_JWT',
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error('Missing required environment variables: ' + missing.join(', '));
  process.exitCode = 2;
} else {
  const url = new URL(process.env.SUPABASE_URL);
  assert.equal(url.protocol, 'https:', 'Supabase must use HTTPS');
  const key = process.env.SUPABASE_PUBLIC_KEY;
  const identities = [
    { label: 'region A', token: process.env.TELEMETRY_TEST_REGION_A_JWT, region: process.env.TELEMETRY_TEST_REGION_A },
    { label: 'region B', token: process.env.TELEMETRY_TEST_REGION_B_JWT, region: process.env.TELEMETRY_TEST_REGION_B },
  ];
  assert.notEqual(identities[0].token, identities[1].token, 'Test accounts must be distinct');
  assert.notEqual(identities[0].region, identities[1].region, 'Test regions must differ');

  async function rpc(name, token, args = {}) {
    const response = await fetch(new URL('/rest/v1/rpc/' + name, url), {
      method: 'POST',
      headers: { apikey: key, authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }

  const readRpc = [
    ['get_telemetry_customer_site_directory', { p_offset: 0, p_limit: 10 }],
    ['get_telemetry_archive', { p_kind: 'machines', p_offset: 0, p_limit: 10 }],
    ['get_telemetry_archive', { p_kind: 'devices', p_offset: 0, p_limit: 10 }],
    ['get_telemetry_factory_directory', { p_view: 'devices', p_offset: 0, p_limit: 10 }],
    ['get_machine_profile_directory', { p_offset: 0, p_limit: 10 }],
    ['get_telemetry_maintenance_directory', { p_status: 'all', p_offset: 0, p_limit: 10 }],
  ];
  let failures = 0;
  for (const identity of identities) {
    for (const [name, args] of readRpc) {
      const { status, body } = await rpc(name, identity.token, args);
      const title = identity.label + ' / ' + name + (args.p_kind ? '/' + args.p_kind : '');
      try {
        assert.equal(status, 200, 'RPC must succeed');
        assert.equal(body.telemetry_region, identity.region, 'RPC must report account region');
        assert.ok(Array.isArray(body.rows), 'Expected paginated rows array');
        assert.ok(Number.isFinite(Number(body.total)), 'Expected result total');
        console.log('PASS ' + title + ' (rows=' + body.rows.length + ', total=' + body.total + ')');
      } catch (error) {
        failures++;
        console.error('FAIL ' + title + ': ' + error.message + ' (HTTP ' + status + ')');
      }
    }
  }
  for (const name of ['get_telemetry_factory_directory', 'get_machine_profile_directory', 'get_machine_profile_detail']) {
    const args = name === 'get_machine_profile_detail' ? { p_profile_id: '00000000-0000-0000-0000-000000000000' } : {};
    const { status } = await rpc(name, process.env.TELEMETRY_TEST_NONADMIN_JWT, args);
    if (status === 403) console.log('PASS non-admin denied / ' + name);
    else { failures++; console.error('FAIL non-admin / ' + name + ': expected HTTP 403, got ' + status); }
  }
  if (failures) {
    console.error(failures + ' integration check(s) failed');
    process.exitCode = 1;
  } else {
    console.log('Runtime role/region response checks passed. NOTE: This is not proof of row-level non-leakage without region-specific canary records.');
  }
}
