import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function resolveCandidate(basePath) {
  if (existsSync(basePath) && path.extname(basePath)) return basePath;
  for (const extension of extensions) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const extension of extensions) {
    const candidate = path.join(basePath, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const candidate = resolveCandidate(path.join(repositoryRoot, specifier.slice(2)));
    if (!candidate) throw new Error(`Could not resolve test alias ${specifier}`);
    return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }

  if (specifier.startsWith('.') && context.parentURL) {
    const parentPath = path.dirname(fileURLToPath(context.parentURL));
    const candidate = resolveCandidate(path.resolve(parentPath, specifier));
    if (candidate) return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const transpiled = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        isolatedModules: true,
      },
    });
    return { format: 'module', source: transpiled.outputText, shortCircuit: true };
  }

  return nextLoad(url, context);
}
