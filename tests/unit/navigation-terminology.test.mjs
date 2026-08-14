import assert from 'node:assert/strict';
import test from 'node:test';

import { navSections, roleHomePath } from '../../lib/auth/permissions.ts';
import { MY_WORK_LABEL, TODAY_LABEL, TODAY_OPEN_LABEL } from '../../lib/navigation/terminology.ts';

const roles = [
  'admin',
  'operations',
  'sales',
  'finance',
  'marketing',
  'executive',
  'warehouse_staff',
  'technician',
  'road_technician',
];

test('role landing terminology is Today while dashboards keep explicit dashboard names', () => {
  assert.equal(TODAY_LABEL, 'Today');
  assert.equal(MY_WORK_LABEL, 'My Work');
  assert.equal(TODAY_OPEN_LABEL, 'Open Today');

  for (const role of roles) assert.equal(roleHomePath[role], '/workspace');

  const workspaceItems = navSections.flatMap((section) => section.items).filter((item) => item.href === '/workspace');
  assert.ok(workspaceItems.length > 0);
  assert.deepEqual(new Set(workspaceItems.map((item) => item.label)), new Set([TODAY_LABEL]));

  const adminDashboard = navSections.flatMap((section) => section.items).find((item) => item.href === '/');
  assert.equal(adminDashboard?.label, 'System Dashboard');

  const operationsDashboard = navSections.flatMap((section) => section.items).find((item) => item.href === '/operations/dashboard');
  assert.equal(operationsDashboard?.label, 'Operations Dashboard');
});
