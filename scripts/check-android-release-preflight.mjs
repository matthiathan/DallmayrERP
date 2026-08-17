import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';

const root = process.cwd();
const androidDir = path.join(root, 'android');
const appDir = path.join(androidDir, 'app');

function fail(message) {
  throw new Error(`Android release preflight failed: ${message}`);
}

function requireFile(filePath, label) {
  if (!existsSync(filePath)) fail(`${label} is missing at ${path.relative(root, filePath)}.`);
}

function parseProperties(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function requiredProperty(properties, key) {
  const value = properties[key]?.trim();
  if (!value) fail(`android/keystore.properties does not define ${key}.`);
  if (/CHANGE_ME/i.test(value)) fail(`android/keystore.properties still contains the placeholder value for ${key}.`);
  return value;
}

if (process.env.CAPACITOR_SERVER_URL?.trim()) {
  fail('CAPACITOR_SERVER_URL is set. Production Android bundles must package the local field application, not a live-reload server URL.');
}

const keystorePropertiesPath = path.join(androidDir, 'keystore.properties');
requireFile(keystorePropertiesPath, 'Signing properties');
const signingProperties = parseProperties(await readFile(keystorePropertiesPath, 'utf8'));
const storeFile = requiredProperty(signingProperties, 'storeFile');
requiredProperty(signingProperties, 'storePassword');
requiredProperty(signingProperties, 'keyAlias');
requiredProperty(signingProperties, 'keyPassword');

// Gradle's file(...) call in android/app/build.gradle resolves relative paths from android/app.
const resolvedStoreFile = path.resolve(appDir, storeFile);
requireFile(resolvedStoreFile, 'Upload keystore');

const versionCodeText = (process.env.DALLMAYRERP_ANDROID_VERSION_CODE ?? '1').trim();
if (!/^\d+$/.test(versionCodeText) || Number(versionCodeText) < 1 || !Number.isSafeInteger(Number(versionCodeText))) {
  fail(`DALLMAYRERP_ANDROID_VERSION_CODE must be a positive integer. Received: ${versionCodeText || '(empty)'}.`);
}
const versionName = (process.env.DALLMAYRERP_ANDROID_VERSION_NAME ?? '1.0.0').trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(versionName)) {
  fail(`DALLMAYRERP_ANDROID_VERSION_NAME must use a release version such as 1.0.0. Received: ${versionName || '(empty)'}.`);
}

const runtimeConfigPath = path.join(root, 'native', 'mobile', 'www', 'runtime-config.js');
const scannerPath = path.join(root, 'native', 'mobile', 'www', 'vendor', 'html5-qrcode.min.js');
requireFile(runtimeConfigPath, 'Prepared native runtime configuration');
requireFile(scannerPath, 'Packaged barcode scanner runtime');

const runtimeSource = await readFile(runtimeConfigPath, 'utf8');
const context = { window: {} };
try {
  vm.runInNewContext(runtimeSource, context, { filename: 'runtime-config.js', timeout: 1_000 });
} catch (error) {
  fail(`runtime-config.js could not be evaluated: ${error.message}`);
}
const runtimeConfig = context.window.__DALLMAYRERP_NATIVE_CONFIG__;
if (!runtimeConfig || typeof runtimeConfig !== 'object') fail('runtime-config.js does not define the native runtime configuration object.');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(runtimeConfig.supabaseUrl ?? ''))) {
  fail('runtime-config.js does not contain a valid HTTPS Supabase project URL.');
}
const anonKey = String(runtimeConfig.anonKey ?? '').trim();
if (!anonKey || /dummy-build-key|__DALLMAYRERP/i.test(anonKey)) fail('runtime-config.js does not contain a usable Supabase anon key.');

const requiredAndroidResources = [
  'app/src/main/res/mipmap-mdpi/ic_launcher.png',
  'app/src/main/res/mipmap-hdpi/ic_launcher.png',
  'app/src/main/res/mipmap-xhdpi/ic_launcher.png',
  'app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
  'app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  'app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
];
for (const resource of requiredAndroidResources) requireFile(path.join(androidDir, resource), `Android launcher resource ${resource}`);

console.log('Android release preflight passed.');
console.log(`Package: za.co.dallmayr.erp`);
console.log(`Version: ${versionName} (${versionCodeText})`);
console.log(`Supabase project: ${new URL(runtimeConfig.supabaseUrl).hostname}`);
console.log(`Signing key: ${path.basename(resolvedStoreFile)} / alias ${signingProperties.keyAlias}`);
console.log('Release mode: local bundled field application (no CAPACITOR_SERVER_URL).');
