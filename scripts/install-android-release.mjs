import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const outputsDir = path.join(root, 'android', 'app', 'build', 'outputs');
const apkPath = path.join(outputsDir, 'apk', 'release', 'app-release.apk');
const checksumPath = path.join(outputsDir, 'release-checksums.sha256');
const metadataPath = path.join(outputsDir, 'release-metadata.json');
const packageId = 'za.co.dallmayr.erp';
const adbCommand = process.platform === 'win32' ? 'adb.exe' : 'adb';

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function adb(args, options = {}) {
  const result = spawnSync(adbCommand, args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error('Android platform-tools (adb) were not found on PATH. Install Android SDK Platform-Tools and retry.');
  }
  return result;
}

for (const [label, filePath] of [
  ['signed release APK', apkPath],
  ['release checksum manifest', checksumPath],
  ['release metadata', metadataPath],
]) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found. Run npm run mobile:bundle:android first.`);
  }
}

const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
if (metadata?.schemaVersion !== 1 || metadata?.packageId !== packageId || !metadata?.sourceCommit) {
  throw new Error('Release metadata is missing or invalid. Rebuild the release candidate before installing.');
}

const checksumSource = await readFile(checksumPath, 'utf8');
const checksumLine = checksumSource
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith('apk/release/app-release.apk'));
if (!checksumLine) throw new Error('Release checksum manifest does not contain the signed APK entry. Rebuild the release candidate.');
const expectedHash = checksumLine.trim().split(/\s+/)[0]?.toLowerCase();
const actualHash = String(await sha256(apkPath)).toLowerCase();
if (
  !expectedHash
  || expectedHash !== actualHash
  || String(metadata.apk?.sha256 || '').toLowerCase() !== actualHash
) {
  throw new Error('Signed APK checksum does not match both the release manifest and release metadata. Do not install this package; rebuild the release candidate.');
}

const devicesResult = adb(['devices']);
if (devicesResult.status !== 0) throw new Error(devicesResult.stderr || 'Could not query connected Android devices.');
const devices = String(devicesResult.stdout)
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter(([serial, state]) => serial && state === 'device')
  .map(([serial]) => serial);

const requestedSerial = process.env.ANDROID_SERIAL?.trim();
let serial;
if (requestedSerial) {
  if (!devices.includes(requestedSerial)) {
    throw new Error(`ANDROID_SERIAL=${requestedSerial} is not an authorized connected device. Available devices: ${devices.join(', ') || 'none'}.`);
  }
  serial = requestedSerial;
} else if (devices.length === 1) {
  [serial] = devices;
} else if (devices.length === 0) {
  throw new Error('No authorized Android device is connected. Enable USB debugging, authorize this computer, and retry.');
} else {
  throw new Error(`Multiple Android devices are connected (${devices.join(', ')}). Set ANDROID_SERIAL to the intended acceptance-test device.`);
}

console.log(`Verified signed APK SHA-256: ${actualHash}`);
console.log(`Release source commit: ${metadata.sourceCommit}`);
console.log(`Release version: ${metadata.versionName} (${metadata.versionCode})`);
console.log(`Installing ${path.relative(root, apkPath)} on Android device ${serial}...`);
const install = adb(['-s', serial, 'install', '-r', apkPath], { stdio: 'inherit' });
if (install.status !== 0) {
  throw new Error(
    'ADB could not replace the installed application. A common cause is an existing debug build signed with a different key or a higher installed version code. The installer will NOT uninstall the existing app automatically because uninstalling would erase cached jobs and any unsynced closure evidence. Confirm the device has no pending closures, then remove the incompatible build manually if appropriate and rerun the acceptance install.',
  );
}

const verify = adb(['-s', serial, 'shell', 'pm', 'path', packageId]);
if (verify.status !== 0 || !String(verify.stdout).includes('package:')) {
  throw new Error(`ADB reported installation success but ${packageId} could not be verified on device ${serial}.`);
}

const packageDump = adb(['-s', serial, 'shell', 'dumpsys', 'package', packageId]);
if (packageDump.status !== 0) throw new Error(packageDump.stderr || `Could not inspect ${packageId} after installation.`);
const installedVersionCode = String(packageDump.stdout).match(/\bversionCode=(\d+)/)?.[1] ?? '';
const installedVersionName = String(packageDump.stdout).match(/\bversionName=([^\s]+)/)?.[1] ?? '';
if (Number(installedVersionCode) !== Number(metadata.versionCode) || installedVersionName !== String(metadata.versionName)) {
  throw new Error(
    `Installed package version ${installedVersionName || 'unknown'} (${installedVersionCode || 'unknown'}) does not match release metadata ${metadata.versionName} (${metadata.versionCode}).`,
  );
}

console.log(`Verified ${packageId} ${installedVersionName} (${installedVersionCode}) is installed on ${serial}.`);
console.log('Run npm run mobile:acceptance:android:record to create the auditable device acceptance record before testing.');
