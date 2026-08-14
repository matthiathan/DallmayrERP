import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BarChart, DonutChart } from '../../components/ui/MiniCharts.tsx';
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

test('BarChart keeps zero values at zero width and uses exact proportional widths', () => {
  const markup = renderToStaticMarkup(createElement(BarChart, {
    title: 'Branch activity',
    data: [
      { label: 'None', value: 0 },
      { label: 'Half', value: 5 },
      { label: 'Full', value: 10 },
    ],
  }));

  assert.match(markup, /style="width:0%"/);
  assert.match(markup, /style="width:50%"/);
  assert.match(markup, /style="width:100%"/);
});

test('DonutChart renders an all-zero dataset as zero without inventing a segment', () => {
  const markup = renderToStaticMarkup(createElement(DonutChart, {
    title: 'Operational work captured',
    data: [
      { label: 'Closures', value: 0 },
      { label: 'Deliveries', value: 0 },
      { label: 'Stock scans', value: 0 },
    ],
  }));

  assert.match(markup, /<span>0<\/span>/);
  assert.doesNotMatch(markup, /conic-gradient/);
  assert.match(markup, /var\(--content-border, #d8cdbc\)/);
});

test('DonutChart assigns distinct segment colours to distinct positive categories', () => {
  const markup = renderToStaticMarkup(createElement(DonutChart, {
    title: 'Operational mix',
    data: [
      { label: 'Closures', value: 3 },
      { label: 'Deliveries', value: 2 },
      { label: 'Stock scans', value: 1 },
    ],
  }));

  assert.match(markup, /var\(--ui-gold-dark, #6d4b16\)/);
  assert.match(markup, /var\(--ui-gold, #b8862f\)/);
  assert.match(markup, /var\(--ui-focus, #2563eb\)/);
});
