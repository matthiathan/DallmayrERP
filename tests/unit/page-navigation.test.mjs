import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildPageNavigation } from '../../lib/navigation/pageNavigation.ts';

const uuid = '11111111-1111-4111-8111-111111111111';

test('page navigation uses explicit telemetry section metadata in declared order', () => {
  const navigation = buildPageNavigation('/telemetry', {
    title: 'Telemetry Analytics',
    sections: [
      { id: 'sales-trend', label: 'Sales trend' },
      { id: 'product-mix', label: 'Product mix' },
      { id: '#product-mix', label: 'Duplicate product mix' },
      { id: 'bad id', label: 'Invalid id' },
    ],
  });

  assert.equal(navigation.currentLabel, 'Telemetry Analytics');
  assert.deepEqual(navigation.sections, [
    { id: 'sales-trend', label: 'Sales trend' },
    { id: 'product-mix', label: 'Product mix' },
  ]);
});

test('machine detail breadcrumbs never expose URL identifiers and use the stable Machines parent', () => {
  const pathname = `/machines/${uuid}`;
  const navigation = buildPageNavigation(pathname);

  assert.equal(navigation.currentLabel, 'Machine details');
  assert.deepEqual(navigation.backTarget, { href: '/machines', label: 'Machines' });
  assert.equal(navigation.crumbs.at(-1)?.label, 'Machine details');
  assert.equal(navigation.currentLabel.includes(uuid), false);
  assert.equal(navigation.backTarget.label.includes(uuid), false);
  assert.equal(navigation.crumbs.some((crumb) => crumb.label.includes(uuid)), false);
  assert.equal(navigation.crumbs.at(-1)?.href, pathname);
});

test('explicit machine metadata can override the breadcrumb label and back target without changing route structure', () => {
  const navigation = buildPageNavigation(`/machines/${uuid}`, {
    breadcrumbLabel: 'Belluno 01 — Johannesburg',
    parent: { href: '/machines', label: 'Machines' },
  });

  assert.equal(navigation.currentLabel, 'Belluno 01 — Johannesburg');
  assert.equal(navigation.crumbs.at(-1)?.label, 'Belluno 01 — Johannesburg');
  assert.deepEqual(navigation.backTarget, { href: '/machines', label: 'Machines' });
});

test('Breadcrumbs has no DOM-scanning or runtime heading mutation contract', async () => {
  const source = await readFile(new URL('../../components/ui/Breadcrumbs.tsx', import.meta.url), 'utf8');
  for (const forbidden of ['MutationObserver', 'querySelectorAll', 'SECTION_SELECTOR', 'requestAnimationFrame', 'heading.id =']) {
    assert.equal(source.includes(forbidden), false, `Breadcrumbs must not contain ${forbidden}`);
  }
  assert.match(source, /usePageNavigationMetadata/);
  assert.match(source, /buildPageNavigation/);
});

test('machine detail route delegates presentation to the rebuilt MachineDetail workspace', async () => {
  const source = await readFile(new URL('../../app/machines/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /MachineDetail/);
  assert.match(source, /machineId=\{id\}/);
  assert.doesNotMatch(source, /MachineDashboard/);
  assert.doesNotMatch(source, /MachineTelemetryOverview/);
});
