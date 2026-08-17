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

const erpLayout = read('components/ui/ErpLayout.tsx');
const workspacePrimitives = read('components/ui/WorkspacePrimitives.tsx');
const pageToolbar = read('components/ui/PageToolbar.tsx');
const shellPages = [
  ['service jobs', read('app/operations/service-jobs/page.tsx')],
  ['deliveries', read('app/operations/deliveries/page.tsx')],
  ['machine assets', read('app/operations/assets/page.tsx')],
  ['executive reports', read('app/executive/reports/page.tsx')],
];

for (const exportName of ['ErpSurface', 'ErpSectionHeader', 'ErpCommandBar', 'ErpPage', 'ErpPageHeader', 'ErpPanel', 'ErpStateBanner']) {
  requireText('ErpLayout', erpLayout, `export function ${exportName}`, `${exportName} must remain owned by the canonical high-level ERP layout module.`);
}

requireText('WorkspacePrimitives', workspacePrimitives, 'ErpCommandBar as WorkspaceCommandBar', 'WorkspaceCommandBar must be a compatibility alias to ErpLayout.');
requireText('WorkspacePrimitives', workspacePrimitives, 'ErpSectionHeader as WorkspaceSectionHeader', 'WorkspaceSectionHeader must be a compatibility alias to ErpLayout.');
requireText('WorkspacePrimitives', workspacePrimitives, 'ErpSurface as WorkspaceSurface', 'WorkspaceSurface must be a compatibility alias to ErpLayout.');
forbid('WorkspacePrimitives', workspacePrimitives, 'function Workspace', 'WorkspacePrimitives must not reintroduce a competing high-level implementation.');
forbid('WorkspacePrimitives', workspacePrimitives, '<section', 'WorkspacePrimitives must stay compatibility-only and contain no rendered surface implementation.');

requireText('PageToolbar', pageToolbar, "from '@/components/ui/ErpLayout'", 'PageToolbar must consume the canonical ErpLayout authority directly.');
forbid('PageToolbar', pageToolbar, "from '@/components/ui/WorkspacePrimitives'", 'PageToolbar must not depend on the retired competing workspace implementation layer.');
requireText('PageToolbar', pageToolbar, '<ErpCommandBar', 'PageToolbar must use the canonical ERP command bar.');
requireText('PageToolbar', pageToolbar, '<ErpSectionHeader', 'PageToolbar must use the canonical ERP section header.');

for (const [name, source] of shellPages) {
  requireText(name, source, '<ErpPage', 'route shell must use the canonical ERP page container.');
  requireText(name, source, '<ErpPageHeader', 'route shell must use the canonical ERP page header.');
  for (const legacy of ['page-header', 'hero-panel', 'spatial-card', 'neo-card']) {
    forbid(name, source, legacy, `route shell must not reintroduce legacy ${legacy} surface markup.`);
  }
}

if (failures.length > 0) {
  console.error('Design-system authority contract failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Design-system authority contract passed: DesignSystem owns low-level controls, ErpLayout owns high-level surfaces/layout, WorkspacePrimitives is compatibility-only, and core route shells use canonical ERP primitives.');
