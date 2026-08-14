import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'lib', 'dashboards', 'shared-dashboard-catalog.ts');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260814065000_add_shared_dashboards.sql');
const catalogSource = fs.readFileSync(catalogPath, 'utf8');
const migrationSource = fs.readFileSync(migrationPath, 'utf8');

const roles = [
  'admin',
  'operations',
  'warehouse_staff',
  'technician',
  'road_technician',
  'executive',
  'sales',
  'finance',
  'marketing',
];

function extractQuotedKeys(source) {
  return [...source.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((match) => match[1]);
}

function catalogKeys(role) {
  const nextRoleIndex = roles.indexOf(role) + 1;
  const nextRole = roles[nextRoleIndex];
  const startToken = `  ${role}: [`;
  const start = catalogSource.indexOf(startToken);
  if (start < 0) throw new Error(`Catalog role block missing: ${role}`);
  const end = nextRole
    ? catalogSource.indexOf(`  ${nextRole}: [`, start + startToken.length)
    : catalogSource.indexOf('\n};', start + startToken.length);
  if (end < 0) throw new Error(`Catalog role block is not terminated: ${role}`);
  return extractQuotedKeys(catalogSource.slice(start, end)).filter((value) => value.includes('_') || value === 'business_users');
}

function databaseKeys(role) {
  const startToken = `when '${role}' then p_metric = any(array[`;
  const start = migrationSource.indexOf(startToken);
  if (start < 0) throw new Error(`Database role allowlist missing: ${role}`);
  const end = migrationSource.indexOf(']::text[])', start + startToken.length);
  if (end < 0) throw new Error(`Database role allowlist is not terminated: ${role}`);
  return extractQuotedKeys(migrationSource.slice(start, end));
}

for (const role of roles) {
  const ui = [...new Set(catalogKeys(role))].sort();
  const db = [...new Set(databaseKeys(role))].sort();
  if (JSON.stringify(ui) !== JSON.stringify(db)) {
    console.error(`Shared dashboard metric contract mismatch for ${role}.`);
    console.error(`UI: ${ui.join(', ')}`);
    console.error(`DB: ${db.join(', ')}`);
    process.exit(1);
  }
}

for (const forbidden of ['rpc_name', 'sql_expression', 'query_text', 'drilldown_url']) {
  if (migrationSource.includes(forbidden)) {
    console.error(`Shared dashboard schema must not persist arbitrary execution/navigation field: ${forbidden}`);
    process.exit(1);
  }
}

console.log(`Shared dashboard contract check passed for ${roles.length} role allowlists.`);
