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

const shell = read('components/layout/AppShell.tsx');
const erpLayout = read('components/ui/ErpLayout.tsx');
const serviceJobsPage = read('app/operations/service-jobs/page.tsx');
const connectedWorkflow = read('components/layout/ConnectedWorkflowBar.tsx');
const connectedWorkflowStyles = read('app/styles/connected-workflow-strip.css');

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
  '<h1>Scheduled Call Log</h1>',
  'the representative operational route must retain its page-owned h1.',
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

if (failures.length) {
  console.error('Page and supporting-context hierarchy contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Page and supporting-context hierarchy contract passed.');
