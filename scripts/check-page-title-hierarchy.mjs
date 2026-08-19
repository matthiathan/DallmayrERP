import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

function requireText(sourceName, source, expected, message) {
  if (!source.includes(expected)) failures.push(`${sourceName}: ${message}`);
}

function forbid(sourceName, source, forbidden, message) {
  if (source.includes(forbidden)) failures.push(`${sourceName}: ${message}`);
}

function requireOrder(sourceName, source, orderedMarkers, message) {
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = source.indexOf(marker);
    if (index === -1 || index <= previous) {
      failures.push(`${sourceName}: ${message}`);
      return;
    }
    previous = index;
  }
}

const shell = read('components/layout/AppShell.tsx');
const erpLayout = read('components/ui/ErpLayout.tsx');
const serviceJobsPage = read('app/operations/service-jobs/page.tsx');
const connectedWorkflow = read('components/layout/ConnectedWorkflowBar.tsx');
const connectedWorkflowStyles = read('app/styles/connected-workflow-strip.css');
const telemetryPage = read('app/telemetry/page.tsx');
const telemetryLive = read('components/features/TelemetryLiveControl.tsx');
const telemetryActivity = read('components/features/TelemetryActivityLog.tsx');
const pageTemplates = read('lib/layout/page-templates.ts');

requireText(
  'application shell',
  shell,
  'const activeArea = activeSection?.heading ?? roleLabels[userDetails.role];',
  'the desktop shell must derive an area-level context separately from the route title.',
);
requireText(
  'application shell',
  shell,
  'aria-label={`Current area: ${activeArea}`}',
  'the shell context must identify itself as application area metadata.',
);
requireText(
  'application shell',
  shell,
  '<span>{activeArea}</span>',
  'the visible shell context must show the application area rather than the page title.',
);
forbid(
  'application shell',
  shell,
  '<strong>{activeTitle}</strong>',
  'the route title must not be rendered as a competing shell heading.',
);
requireText(
  'ERP page header',
  erpLayout,
  '<h1>{title}</h1>',
  'canonical ERP pages must retain the page-level h1 as the document title.',
);
requireText(
  'service jobs page',
  serviceJobsPage,
  '<ErpPageHeader',
  'the representative operational route must delegate its page-owned h1 to the canonical ERP page header.',
);
requireText(
  'service jobs page',
  serviceJobsPage,
  'title="Scheduled Call Log"',
  'the representative operational route must retain Scheduled Call Log as its canonical page title.',
);
forbid(
  'service jobs page',
  serviceJobsPage,
  '<h1>Scheduled Call Log</h1>',
  'the representative operational route must not duplicate the canonical ErpPageHeader h1 in route markup.',
);

requireText(
  'connected workflow',
  connectedWorkflow,
  'className="connected-workflow-strip"',
  'connected record context must use the compact supporting strip.',
);
requireText(
  'connected workflow',
  connectedWorkflow,
  '<nav aria-label="Connected records" className="connected-workflow-links">',
  'related-record navigation must remain directly available in the compact strip.',
);
forbid(
  'connected workflow',
  connectedWorkflow,
  'className="neo-card"',
  'connected record context must not compete with route content as a full card.',
);
forbid(
  'connected workflow',
  connectedWorkflow,
  'page-toolbar-heading',
  'connected record context must not use page-heading presentation.',
);
forbid(
  'connected workflow',
  connectedWorkflow,
  'feature-pill',
  'connected record context must not reuse prominent generic feature pills.',
);
requireText(
  'connected workflow styles',
  connectedWorkflowStyles,
  '.connected-workflow-strip {',
  'the compact connected workflow strip must have owned application styling.',
);
requireText(
  'connected workflow styles',
  connectedWorkflowStyles,
  'box-shadow: none;',
  'the supporting connected workflow strip must remain visually flatter than page cards.',
);

requireText(
  'telemetry page',
  telemetryPage,
  'aria-label="Telemetry page sections"',
  'long telemetry dashboards must provide direct in-page navigation.',
);
requireOrder(
  'telemetry page',
  telemetryPage,
  [
    'id="telemetry-live"',
    'id="telemetry-location"',
    'id="telemetry-activity"',
    'id="telemetry-reporting"',
    'id="telemetry-poc"',
  ],
  'telemetry must keep live health, location and activity above history and POC tools.',
);
requireText(
  'telemetry live health',
  telemetryLive,
  'label="Active faults"',
  'live telemetry must expose an active-fault summary near the top.',
);
requireOrder(
  'telemetry live health',
  telemetryLive,
  ['<h3>Active machine faults</h3>', '<details className="telemetry-device-controls"'],
  'active faults must appear before remote device configuration.',
);
requireOrder(
  'telemetry activity',
  telemetryActivity,
  ['aria-label="Sales and error summary"', 'aria-label="Activity filters and sorting"', '<div className="table-scroll"'],
  'sales/error summary must precede filters and detailed activity rows.',
);
requireText(
  'page templates',
  pageTemplates,
  "'/telemetry',",
  'Machine Telemetry must be explicitly classified as a dashboard workspace.',
);
requireText(
  'page templates',
  pageTemplates,
  "'/telemetry/devices',",
  'Telemetry device administration must be explicitly classified as a list workspace.',
);

if (failures.length) {
  console.error('Page and supporting-context hierarchy contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Page and supporting-context hierarchy contract passed.');
