import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENTERPRISE_NAVIGATION_HEADINGS,
  enterpriseNavigationHeadingFor,
  groupEnterpriseNavigationSections,
  isEnterpriseNavigationRole,
} from '../../lib/navigation/enterpriseNavigation.ts';

function item(href, label) {
  return { href, label, code: `T-${label}`, roles: 'all' };
}

function fixtureSections() {
  return [
    {
      heading: 'System',
      items: [
        item('/workspace', 'Today'),
        item('/', 'System Dashboard'),
        item('/admin/users', 'Users & Roles'),
      ],
    },
    {
      heading: 'Communications',
      items: [item('/work/messages', 'Messages')],
    },
    {
      heading: 'Transactions',
      items: [
        item('/work', 'Action Centre'),
        item('/operations/service-jobs', 'Scheduled Call Log'),
        item('/warehouse/stock', 'Stock Control'),
      ],
    },
    {
      heading: 'Masters',
      items: [item('/customers', 'Customer Master')],
    },
    {
      heading: 'Fixed Assets',
      items: [item('/operations/assets', 'Fixed Asset Master List')],
    },
    {
      heading: 'Sales',
      items: [item('/finance', 'Finance Workspace')],
    },
    {
      heading: 'Reports',
      items: [item('/executive/branches', 'Branch Performance')],
    },
    {
      heading: 'Telemetry',
      items: [item('/telemetry', 'Machine Telemetry')],
    },
    {
      heading: 'Utilities',
      items: [item('/utilities/data-matching', 'Data Matching Workbench')],
    },
  ];
}

test('enterprise navigation roles are limited to administrator and executive', () => {
  assert.equal(isEnterpriseNavigationRole('admin'), true);
  assert.equal(isEnterpriseNavigationRole('executive'), true);
  assert.equal(isEnterpriseNavigationRole('operations'), false);
  assert.equal(isEnterpriseNavigationRole('finance'), false);
});

test('enterprise navigation maps routes into task-oriented areas', () => {
  assert.equal(enterpriseNavigationHeadingFor('System', '/workspace'), 'Work');
  assert.equal(enterpriseNavigationHeadingFor('Transactions', '/operations/service-jobs'), 'Work');
  assert.equal(enterpriseNavigationHeadingFor('Masters', '/customers'), 'Customers & Assets');
  assert.equal(enterpriseNavigationHeadingFor('Fixed Assets', '/operations/assets/lifecycle'), 'Customers & Assets');
  assert.equal(enterpriseNavigationHeadingFor('Transactions', '/warehouse/stock'), 'Inventory');
  assert.equal(enterpriseNavigationHeadingFor('Sales', '/finance/service-coverage'), 'Commercial');
  assert.equal(enterpriseNavigationHeadingFor('Reports', '/executive/branches'), 'Insights');
  assert.equal(enterpriseNavigationHeadingFor('Telemetry', '/telemetry'), 'Insights');
  assert.equal(enterpriseNavigationHeadingFor('System', '/admin/users'), 'Administration');
  assert.equal(enterpriseNavigationHeadingFor('Utilities', '/utilities/data-matching'), 'Administration');
});

test('enterprise grouping preserves every unique route while reducing top-level sections', () => {
  const source = fixtureSections();
  const grouped = groupEnterpriseNavigationSections('admin', source);

  assert.deepEqual(grouped.map((section) => section.heading), ENTERPRISE_NAVIGATION_HEADINGS);

  const sourceHrefs = [...new Set(source.flatMap((section) => section.items.map((entry) => entry.href)))];
  const groupedHrefs = grouped.flatMap((section) => section.items.map((entry) => entry.href));
  assert.deepEqual([...groupedHrefs].sort(), [...sourceHrefs].sort());
  assert.equal(new Set(groupedHrefs).size, groupedHrefs.length);

  assert.equal(grouped.find((section) => section.heading === 'Work')?.items[0]?.href, '/workspace');
  assert.equal(grouped.find((section) => section.heading === 'Administration')?.items.some((entry) => entry.href === '/'), true);
});

test('non-enterprise roles keep their existing navigation sections unchanged', () => {
  const source = fixtureSections();
  assert.equal(groupEnterpriseNavigationSections('operations', source), source);
  assert.equal(groupEnterpriseNavigationSections('sales', source), source);
});
