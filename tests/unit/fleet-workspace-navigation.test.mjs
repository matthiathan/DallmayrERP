import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessShellPath, deriveAppShellNavigation } from '../../components/layout/appShellNavigation.ts';

test('daily work stays primary while reports and specialist tools remain discoverable', () => {
  const { navigationSections } = deriveAppShellNavigation('/', 'dallmayr', 'admin');
  assert.deepEqual(navigationSections[0].items.map(({ href }) => href), ['/', '/machines', '/telemetry/reports', '/map', '/telemetry/devices']);
  assert.ok(navigationSections.find(({ heading }) => heading === 'Administration').items.some(({ href }) => href === '/maintenance'));
  const paths = navigationSections.flatMap(({ items }) => items.map(({ href }) => href));
  assert.equal(new Set(paths).size, 17);
  for (const href of ['/customers', '/archive', '/telemetry/test-center', '/map', '/telemetry/devices', '/machine-profiles', '/administration', '/approvals', '/factory', '/technician']) {
    assert.ok(paths.includes(href), `${href} remains reachable`);
  }
});

test('a nested specialist destination opens the correct navigation group', () => {
  const result = deriveAppShellNavigation('/telemetry/devices/settings', 'dallmayr', 'admin');
  assert.equal(result.activeHref, '/telemetry/devices');
  assert.equal(result.activeSection.heading, 'Workspace');
  assert.equal(result.allowedPath, true);
  assert.equal(deriveAppShellNavigation('/telemetry/reports', 'dallmayr', 'admin').activeSection.heading, 'Workspace');
});

test('simplified groups retain customer and staff access boundaries', () => {
  const customer = deriveAppShellNavigation('/machines/example', 'client', 'client_viewer');
  assert.equal(customer.allowedPath, true);
  assert.deepEqual(customer.navigationSections.flatMap(({ items }) => items.map(({ href }) => href)).sort(), ['/', '/machines', '/map', '/telemetry', '/telemetry/reports'].sort());
  for (const path of ['/maintenance', '/administration', '/factory', '/machine-profiles']) {
    assert.equal(canAccessShellPath(path, 'client', 'client_viewer'), false);
  }
  for (const path of ['/administration', '/factory', '/approvals', '/machine-profiles']) {
    assert.equal(canAccessShellPath(path, 'dallmayr', 'technician'), false);
  }
});
