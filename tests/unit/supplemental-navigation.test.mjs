import assert from 'node:assert/strict';
import test from 'node:test';

import { getSupplementalNavigationSections } from '../../lib/navigation/supplementalNavigation.ts';

function hrefs(sections) {
  return sections.flatMap((section) => section.items.map((item) => item.href));
}

test('administrator supplemental navigation includes messaging and telemetry management when enabled', () => {
  const sections = getSupplementalNavigationSections('admin', true);
  assert.deepEqual(sections.map((section) => section.heading), ['Communications', 'Telemetry']);
  assert.deepEqual(hrefs(sections), ['/work/messages', '/telemetry', '/telemetry/devices']);
});

test('executive supplemental navigation includes telemetry without device administration', () => {
  const sections = getSupplementalNavigationSections('executive', true);
  assert.deepEqual(hrefs(sections), ['/work/messages', '/telemetry']);
  assert.equal(hrefs(sections).includes('/telemetry/devices'), false);
});

test('messaging feature state is respected consistently for non-telemetry roles', () => {
  assert.deepEqual(getSupplementalNavigationSections('operations', false), []);
  assert.deepEqual(hrefs(getSupplementalNavigationSections('operations', true)), ['/work/messages']);
});
