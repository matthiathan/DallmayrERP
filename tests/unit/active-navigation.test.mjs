import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isNavigationPathMatch,
  selectActiveNavigationHref,
} from '../../lib/navigation/activeNavigation.ts';

test('active navigation selects the most specific matching route', () => {
  const hrefs = [
    '/operations',
    '/operations/assets',
    '/operations/assets/lifecycle',
    '/operations/service-jobs',
  ];

  assert.equal(selectActiveNavigationHref('/operations/assets/lifecycle', hrefs), '/operations/assets/lifecycle');
  assert.equal(selectActiveNavigationHref('/operations/assets/machine-1', hrefs), '/operations/assets');
  assert.equal(selectActiveNavigationHref('/operations/service-jobs/job-1', hrefs), '/operations/service-jobs');
});

test('active navigation prevents broad parent routes from becoming the current page', () => {
  const hrefs = ['/work', '/work/messages'];
  assert.equal(selectActiveNavigationHref('/work/messages/thread-1', hrefs), '/work/messages');
  assert.equal(selectActiveNavigationHref('/work/item-1', hrefs), '/work');
});

test('root navigation only matches the exact root path', () => {
  assert.equal(isNavigationPathMatch('/', '/'), true);
  assert.equal(isNavigationPathMatch('/admin/users', '/'), false);
  assert.equal(selectActiveNavigationHref('/admin/users', ['/', '/admin/users']), '/admin/users');
  assert.equal(selectActiveNavigationHref('/unknown', ['/']), null);
});
