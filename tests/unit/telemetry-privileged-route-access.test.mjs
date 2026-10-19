import assert from 'node:assert/strict';
import test from 'node:test';

import { canAccessShellPath, deriveAppShellNavigation } from '../../components/layout/appShellNavigation.ts';

test('administrative telemetry workspaces are admin-only even on direct navigation', () => {
  for (const path of ['/administration', '/approvals', '/factory', '/machine-profiles']) {
    assert.equal(canAccessShellPath(path, 'dallmayr', 'admin'), true, `${path} should be available to administrators`);
    for (const role of ['operations', 'technician', 'road_technician', 'executive', 'sales', 'finance']) {
      assert.equal(canAccessShellPath(path, 'dallmayr', role), false, `${path} must be blocked for ${role}`);
    }
    assert.equal(canAccessShellPath(path, 'client', 'client_viewer'), false, `${path} must be blocked for clients`);
  }
});

test('field and archive workspaces remain limited to operational technical roles', () => {
  for (const path of ['/archive', '/technician']) {
    for (const role of ['admin', 'operations', 'technician', 'road_technician']) {
      assert.equal(canAccessShellPath(path, 'dallmayr', role), true, `${path} should be available to ${role}`);
    }
    for (const role of ['executive', 'sales', 'finance', 'marketing', 'warehouse_staff']) {
      assert.equal(canAccessShellPath(path, 'dallmayr', role), false, `${path} must be blocked for ${role}`);
    }
    assert.equal(canAccessShellPath(path, 'client', 'client_viewer'), false, `${path} must be blocked for clients`);
  }
});

test('client navigation remains restricted to explicitly approved read-only telemetry routes', () => {
  const nav = deriveAppShellNavigation('/map', 'client', 'client_viewer');
  const hrefs = nav.navigationSections.flatMap((section) => section.items.map((item) => item.href));

  assert.deepEqual(hrefs.sort(), ['/', '/machines', '/map', '/telemetry', '/telemetry/reports'].sort());
  assert.equal(nav.allowedPath, true);
  assert.equal(canAccessShellPath('/machines/example-machine-id', 'client', 'client_viewer'), true);
  assert.equal(canAccessShellPath('/telemetry/devices', 'client', 'client_viewer'), false);
  assert.equal(canAccessShellPath('/telemetry/test-center', 'client', 'client_viewer'), false);
  assert.equal(canAccessShellPath('/products', 'client', 'client_viewer'), false);
});
