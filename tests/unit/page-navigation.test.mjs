import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildPageNavigation } from '../../lib/navigation/pageNavigation.ts';

const uuid = '11111111-1111-4111-8111-111111111111';

test('page navigation uses explicit section metadata in declared order', () => {
  const navigation = buildPageNavigation('/operations/service-jobs', {
    title: 'Scheduled Call Log',
    sections: [
      { id: 'service-job-overview', label: 'Overview' },
      { id: 'service-job-workspace', label: 'Service workspace' },
      { id: '#service-job-workspace', label: 'Duplicate workspace' },
      { id: 'bad id', label: 'Invalid id' },
    ],
  });

  assert.equal(navigation.currentLabel, 'Scheduled Call Log');
  assert.deepEqual(navigation.sections, [
    { id: 'service-job-overview', label: 'Overview' },
    { id: 'service-job-workspace', label: 'Service workspace' },
  ]);
});

test('dynamic record breadcrumbs never expose URL identifiers and use stable record parents', () => {
  const cases = [
    ['/customers/' + uuid, 'Customer record', '/customers', 'Customer Master'],
    ['/operations/assets/' + uuid, 'Machine record', '/operations/assets', 'Machine Master'],
    ['/work/' + uuid, 'Work item', '/work', 'Action Centre'],
    ['/warehouse/stock/' + uuid, 'Stock item', '/warehouse/stock', 'Stock Control'],
  ];

  for (const [pathname, label, parentHref, parentLabel] of cases) {
    const navigation = buildPageNavigation(pathname);
    assert.equal(navigation.currentLabel, label);
    assert.deepEqual(navigation.backTarget, { href: parentHref, label: parentLabel });
    assert.equal(navigation.crumbs.at(-1)?.label, label);
    assert.equal(JSON.stringify(navigation).includes(uuid), false);
  }
});

test('explicit page metadata can override the breadcrumb label and back target without touching route structure', () => {
  const navigation = buildPageNavigation('/customers/' + uuid, {
    breadcrumbLabel: 'ABC Coffee — Johannesburg',
    parent: { href: '/customers', label: 'Customer Master' },
  });

  assert.equal(navigation.currentLabel, 'ABC Coffee — Johannesburg');
  assert.equal(navigation.crumbs.at(-1)?.label, 'ABC Coffee — Johannesburg');
  assert.deepEqual(navigation.backTarget, { href: '/customers', label: 'Customer Master' });
});

test('Breadcrumbs has no DOM-scanning or runtime heading mutation contract', async () => {
  const source = await readFile(new URL('../../components/ui/Breadcrumbs.tsx', import.meta.url), 'utf8');
  for (const forbidden of ['MutationObserver', 'querySelectorAll', 'SECTION_SELECTOR', 'requestAnimationFrame', 'heading.id =']) {
    assert.equal(source.includes(forbidden), false, `Breadcrumbs must not contain ${forbidden}`);
  }
  assert.match(source, /usePageNavigationMetadata/);
  assert.match(source, /buildPageNavigation/);
});

test('Scheduled Call Log explicitly declares stable section targets', async () => {
  const source = await readFile(new URL('../../app/operations/service-jobs/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /PageNavigationMetadata/);
  assert.match(source, /id: 'service-job-overview'/);
  assert.match(source, /id: 'service-job-workspace'/);
  assert.match(source, /id="service-job-overview"/);
  assert.match(source, /PageSectionAnchor id="service-job-workspace"/);
});
