import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StatusBadge } from '../../components/ui/StatusBadge.tsx';
import { StatusTimeline } from '../../components/ui/StatusTimeline.tsx';

test('StatusBadge formats labels and resolves semantic status tones', () => {
  const warning = renderToStaticMarkup(createElement(StatusBadge, { value: 'in_progress' }));
  assert.match(warning, /status-warning/);
  assert.match(warning, /data-tone="warning"/);
  assert.match(warning, /data-value="in_progress"/);
  assert.match(warning, />In Progress</);

  const overridden = renderToStaticMarkup(createElement(StatusBadge, {
    value: 'unknown_custom_state',
    label: 'Review required',
    tone: 'danger',
  }));
  assert.match(overridden, /status-danger/);
  assert.match(overridden, />Review required</);
});

test('StatusTimeline marks complete, current and pending steps without losing labels', () => {
  const markup = renderToStaticMarkup(createElement(StatusTimeline, {
    currentIndex: 1,
    steps: [
      { label: 'Created', description: 'Request logged' },
      { label: 'Assigned', description: 'Technician assigned' },
      { label: 'Completed', description: 'Work completed' },
    ],
  }));

  assert.match(markup, /is-complete/);
  assert.match(markup, /is-current/);
  assert.match(markup, /is-pending/);
  assert.match(markup, /Created/);
  assert.match(markup, /Technician assigned/);
});

test('StatusTimeline clamps an out-of-range current index and compact mode hides descriptions', () => {
  const markup = renderToStaticMarkup(createElement(StatusTimeline, {
    currentIndex: 99,
    compact: true,
    steps: [
      { label: 'Draft', description: 'Hidden detail' },
      { label: 'Closed', description: 'Also hidden' },
    ],
  }));

  assert.equal((markup.match(/is-current/g) ?? []).length, 1);
  assert.equal((markup.match(/is-complete/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /Hidden detail|Also hidden/);
  assert.match(markup, /is-compact/);
});
