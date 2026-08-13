import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoots = ['app', 'components', 'lib'];
const sqlRoots = ['sql', path.join('supabase', 'migrations')];

function walk(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath, predicate);
    return predicate(fullPath) ? [fullPath] : [];
  });
}

const rpcCalls = new Map();
for (const sourceRoot of sourceRoots) {
  for (const file of walk(path.join(root, sourceRoot), (value) => /\.[cm]?[jt]sx?$/.test(value))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
      const name = match[1];
      const locations = rpcCalls.get(name) ?? [];
      locations.push(path.relative(root, file));
      rpcCalls.set(name, locations);
    }
  }
}

const definitions = new Set();
for (const sqlRoot of sqlRoots) {
  for (const file of walk(path.join(root, sqlRoot), (value) => value.endsWith('.sql'))) {
    const sql = fs.readFileSync(file, 'utf8');
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z0-9_]+)\s*\(/gi)) {
      definitions.add(match[1]);
    }
  }
}

const missing = [...rpcCalls.keys()].filter((name) => !definitions.has(name)).sort();
if (missing.length) {
  console.error('Client RPCs without a repository SQL definition:');
  for (const name of missing) console.error(`- ${name}: ${[...new Set(rpcCalls.get(name))].join(', ')}`);
  process.exit(1);
}

console.log(`RPC contract check passed: ${rpcCalls.size} client RPCs have repository SQL definitions.`);
