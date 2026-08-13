import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourceRoots = ['app', 'components', 'lib'];

function walk(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath, predicate);
    return predicate(fullPath) ? [fullPath] : [];
  });
}

const files = sourceRoots.flatMap((directory) => walk(path.join(root, directory), (value) => /\.[cm]?[jt]sx?$/.test(value)));
const failures = [];
const localStorageAllowlist = new Set([
  // Pre-hydration appearance boot code cannot import the client storage utility.
  'app/layout.tsx',
  // These owners already guard direct storage access with try/catch; keep the exceptions narrow and explicit.
  'components/appearance/AppearanceProvider.tsx',
  'components/boards/useCustomerBoard.ts',
  'components/features/EnterpriseServiceJobBoard.tsx',
  'components/ui/useResizableColumns.ts',
  // Supabase client owns the local-vs-session auth storage adapter and must coordinate both stores atomically.
  'lib/supabase/client.ts',
  // The guarded storage implementation necessarily owns the direct browser API calls.
  'lib/browserStorage.ts',
]);

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  if (/toISOString\(\)\.slice\(0,\s*10\)/.test(source)) {
    failures.push(`${relative}: uses a UTC date for a local business date; use lib/dates/local-date.ts`);
  }
  if (source.includes('window.localStorage') && !localStorageAllowlist.has(relative)) {
    failures.push(`${relative}: accesses localStorage without the guarded storage utility`);
  }

  if (!file.endsWith('.tsx')) continue;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ancestors = [];
  const visit = (node) => {
    ancestors.push(node);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tagName = opening.tagName.getText(sourceFile);
      if (tagName === 'button') {
        const hasType = opening.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.text === 'type');
        const inForm = ancestors.slice(0, -1).some((ancestor) => ts.isJsxElement(ancestor) && ancestor.openingElement.tagName.getText(sourceFile) === 'form');
        if (!hasType && inForm) {
          const position = sourceFile.getLineAndCharacterOfPosition(opening.getStart(sourceFile));
          failures.push(`${relative}:${position.line + 1}: button inside a form must declare type="submit" or type="button"`);
        }
      }
      if (tagName === 'a') {
        const attributes = opening.attributes.properties.filter(ts.isJsxAttribute);
        const target = attributes.find((property) => property.name.text === 'target');
        const rel = attributes.find((property) => property.name.text === 'rel');
        const targetValue = target?.initializer && ts.isStringLiteral(target.initializer) ? target.initializer.text : '';
        const relValue = rel?.initializer && ts.isStringLiteral(rel.initializer) ? rel.initializer.text : '';
        if (targetValue === '_blank' && !/(?:^|\s)(?:noopener|noreferrer)(?:\s|$)/.test(relValue)) {
          const position = sourceFile.getLineAndCharacterOfPosition(opening.getStart(sourceFile));
          failures.push(`${relative}:${position.line + 1}: target="_blank" must use rel="noopener" or rel="noreferrer"`);
        }
      }
    }
    ts.forEachChild(node, visit);
    ancestors.pop();
  };
  visit(sourceFile);
}

if (failures.length) {
  console.error('Source safety check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Source safety check passed across ${files.length} TypeScript files.`);
