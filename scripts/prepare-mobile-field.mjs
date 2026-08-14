import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

async function loadSimpleEnv(fileName) {
  const filePath = path.join(root, fileName);
  if (!existsSync(filePath)) return;
  const source = await readFile(filePath, 'utf8');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

await loadSimpleEnv('.env.local');
await loadSimpleEnv('.env');

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://egbiiizxsqlarqpnzxxs.supabase.co').replace(/\/+$/, '');
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const hostedAppUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://dallmayrerp.onrender.com').replace(/\/+$/, '');

if (!anonKey || anonKey === 'dummy-build-key') {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to prepare the native field app. Put the public Supabase anon key in .env.local or the environment, then rerun npm run mobile:prepare.',
  );
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL must be an https://*.supabase.co URL. Received: ${supabaseUrl}`);
}

const wwwDir = path.join(root, 'native', 'mobile', 'www');
const vendorDir = path.join(wwwDir, 'vendor');
await mkdir(vendorDir, { recursive: true });

const scannerCandidates = [
  path.join(root, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'),
  path.join(root, 'node_modules', 'html5-qrcode', 'dist', 'html5-qrcode.min.js'),
];
const scannerSource = scannerCandidates.find((candidate) => existsSync(candidate));
if (!scannerSource) {
  throw new Error('html5-qrcode browser bundle was not found. Run npm ci before npm run mobile:prepare.');
}

await copyFile(scannerSource, path.join(vendorDir, 'html5-qrcode.min.js'));

const runtimeConfig = `window.__DALLMAYRERP_NATIVE_CONFIG__ = Object.freeze(${JSON.stringify(
  {
    supabaseUrl,
    anonKey,
    hostedAppUrl,
    preparedAt: new Date().toISOString(),
  },
  null,
  2,
)});\n`;

await writeFile(path.join(wwwDir, 'runtime-config.js'), runtimeConfig, 'utf8');

console.log('Prepared the local DallmayrERP Android field bundle.');
console.log(`Supabase project: ${new URL(supabaseUrl).hostname}`);
console.log(`Web assets: ${path.relative(root, wwwDir)}`);
