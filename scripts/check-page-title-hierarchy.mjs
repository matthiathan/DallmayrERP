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

if (failures.length) {
  console.error('Page title hierarchy contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Page title hierarchy contract passed.');
