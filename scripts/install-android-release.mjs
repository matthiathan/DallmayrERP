import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const apkPath = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const checksumPath = path.join(root, 'android', 'app', 'build', 'outputs', 'release-checksums.sha256');
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

if (!existsSync(apkPath)) {
  throw new Error('Signed release APK not found. Run npm run mobile:bundle:android first.');
}
if (!existsSync(checksumPath)) {
  throw new Error('Release checksum manifest not found. Rebuild with npm run mobile:bundle:android before installing.');
}

const checksumSource = await readFile(checksumPath, 'utf8');
const checksumLine = checksumSource
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith('apk/release/app-release.apk'));
if (!checksumLine) throw new Error('Release checksum manifest does not contain the signed APK entry. Rebuild the release candidate.');
const expectedHash = checksumLine.trim().split(/\s+/)[0]?.toLowerCase();
const actualHash = String(await sha256(apkPath)).toLowerCase();
if (!expectedHash || expectedHash !== actualHash) {
  throw new Error('Signed APK checksum does not match the release manifest. Do not install this package; rebuild the release candidate.');
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
console.log(`Installing ${path.relative(root, apkPath)} on Android device ${serial}...`);
const install = adb(['-s', serial, 'install', '-r', apkPath], { stdio: 'inherit', encoding: undefined });
if (install.status !== 0) process.exit(install.status ?? 1);

const verify = adb(['-s', serial, 'shell', 'pm', 'path', packageId]);
if (verify.status !== 0 || !String(verify.stdout).includes('package:')) {
  throw new Error(`ADB reported installation success but ${packageId} could not be verified on device ${serial}.`);
}

console.log(`Verified ${packageId} is installed on ${serial}.`);
console.log('Proceed with docs/ANDROID_RELEASE_CHECKLIST.md device acceptance checks before wider distribution.');
