import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const outputsDir = path.join(root, 'android', 'app', 'build', 'outputs');
const apkPath = path.join(outputsDir, 'apk', 'release', 'app-release.apk');
const checksumPath = path.join(outputsDir, 'release-checksums.sha256');
const metadataPath = path.join(outputsDir, 'release-metadata.json');
const acceptanceDir = path.join(outputsDir, 'acceptance');
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

function adb(args) {
  const result = spawnSync(adbCommand, args, { cwd: root, encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    throw new Error('Android platform-tools (adb) were not found on PATH. Install Android SDK Platform-Tools and retry.');
  }
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `adb ${args.join(' ')} failed.`).trim());
  }
  return String(result.stdout).trim();
}

function shell(serial, ...args) {
  return adb(['-s', serial, 'shell', ...args]);
}

function safeFilePart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function selectDevice() {
  const devices = adb(['devices'])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);

  const requestedSerial = process.env.ANDROID_SERIAL?.trim();
  if (requestedSerial) {
    if (!devices.includes(requestedSerial)) {
      throw new Error(`ANDROID_SERIAL=${requestedSerial} is not an authorized connected device. Available devices: ${devices.join(', ') || 'none'}.`);
    }
    return requestedSerial;
  }
  if (devices.length === 1) return devices[0];
  if (devices.length === 0) throw new Error('No authorized Android device is connected. Enable USB debugging, authorize this computer, and retry.');
  throw new Error(`Multiple Android devices are connected (${devices.join(', ')}). Set ANDROID_SERIAL to the intended acceptance-test device.`);
}

for (const [label, filePath] of [
  ['signed release APK', apkPath],
  ['release checksum manifest', checksumPath],
  ['release metadata', metadataPath],
]) {
  if (!existsSync(filePath)) throw new Error(`${label} not found. Run npm run mobile:bundle:android first.`);
}

const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
if (metadata?.packageId !== packageId || metadata?.schemaVersion !== 1) {
  throw new Error('Release metadata is not a recognized DallmayrERP Android release candidate. Rebuild before acceptance testing.');
}

const checksumSource = await readFile(checksumPath, 'utf8');
const apkChecksumLine = checksumSource
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith('apk/release/app-release.apk'));
const manifestHash = apkChecksumLine?.trim().split(/\s+/)[0]?.toLowerCase();
const actualHash = String(await sha256(apkPath)).toLowerCase();
if (!manifestHash || manifestHash !== actualHash || String(metadata.apk?.sha256 || '').toLowerCase() !== actualHash) {
  throw new Error('Release APK integrity does not match both the checksum manifest and release metadata. Rebuild before acceptance testing.');
}

const serial = selectDevice();
const installedPath = shell(serial, 'pm', 'path', packageId);
if (!installedPath.includes('package:')) {
  throw new Error(`${packageId} is not installed on ${serial}. Run npm run mobile:install:android:release first.`);
}

const packageDump = shell(serial, 'dumpsys', 'package', packageId);
const installedVersionCode = packageDump.match(/\bversionCode=(\d+)/)?.[1] ?? '';
const installedVersionName = packageDump.match(/\bversionName=([^\s]+)/)?.[1] ?? '';
if (!installedVersionCode || Number(installedVersionCode) !== Number(metadata.versionCode)) {
  throw new Error(`Installed versionCode ${installedVersionCode || 'unknown'} does not match release metadata versionCode ${metadata.versionCode}.`);
}
if (!installedVersionName || installedVersionName !== String(metadata.versionName)) {
  throw new Error(`Installed versionName ${installedVersionName || 'unknown'} does not match release metadata versionName ${metadata.versionName}.`);
}

const manufacturer = shell(serial, 'getprop', 'ro.product.manufacturer') || 'Unknown';
const model = shell(serial, 'getprop', 'ro.product.model') || 'Unknown';
const androidVersion = shell(serial, 'getprop', 'ro.build.version.release') || 'Unknown';
const apiLevel = shell(serial, 'getprop', 'ro.build.version.sdk') || 'Unknown';
const securityPatch = shell(serial, 'getprop', 'ro.build.version.security_patch') || 'Unknown';
const generatedAt = new Date();
const generatedIso = generatedAt.toISOString();
const stamp = generatedIso.replace(/[:.]/g, '-');
const recordPath = path.join(acceptanceDir, `${stamp}-${safeFilePart(serial)}.md`);
const tester = process.env.ACCEPTANCE_TESTER?.trim() || '';

const checks = [
  'Fresh online sign-in for a technician account.',
  'Fresh online sign-in for a road-technician account.',
  'A non-field role is rejected.',
  'Assigned-job refresh succeeds and the local cache timestamp updates.',
  'Cold-launch works offline after a successful authorized online session.',
  'Live camera barcode/QR scan identifies the assigned machine.',
  'Scan from photo identifies the assigned machine.',
  'Manual machine code fallback works.',
  'Incorrect machine code blocks closure.',
  'Correct machine code permits local closure save.',
  'Closure without a photo queues safely while offline.',
  'Closure with evidence photo queues safely while offline.',
  'App/process restart retains queued closure and cached jobs.',
  'Reconnect automatically syncs a valid queued closure.',
  'A reassigned or already-closed server job becomes Needs review instead of disappearing.',
  'A synced closure appears correctly in the hosted ERP and audit history.',
  'Sign-out is blocked while unsynced closures remain.',
  'Sign-out clears cached jobs after the outbox is empty.',
  'Android permission prompts match the approved privacy/store disclosures.',
];

const content = `# DallmayrERP Android Device Acceptance Record

**Status:** IN PROGRESS  
**Generated:** ${generatedIso}  
**Tester:** ${tester || '________________'}

## Release candidate identity

- Package ID: \`${packageId}\`
- Version code: \`${metadata.versionCode}\`
- Version name: \`${metadata.versionName}\`
- Source commit: \`${metadata.sourceCommit}\`
- Source tree clean at build: \`${metadata.sourceTreeClean === true ? 'yes' : 'no'}\`
- Release built: \`${metadata.builtAt}\`
- APK SHA-256: \`${actualHash}\`
- AAB SHA-256: \`${metadata.aab?.sha256 || 'unavailable'}\`

## Device identity

- ADB serial: \`${serial}\`
- Manufacturer: ${manufacturer}
- Model: ${model}
- Android version: ${androidVersion}
- Android API level: ${apiLevel}
- Security patch: ${securityPatch}
- Installed package path: \`${installedPath.replace(/^package:/, '')}\`
- Installed version code: \`${installedVersionCode}\`
- Installed version name: \`${installedVersionName}\`

## Acceptance checks

${checks.map((check) => `- [ ] ${check}`).join('\n')}

## Result

- [ ] PASS — approved for the next controlled distribution stage.
- [ ] FAIL — release candidate must not progress.

**Completed by:** ______________________________  
**Completion date/time:** ______________________  
**Failure/exception references:** ______________

## Notes

Record device-specific behavior, service job IDs used for validation, any Needs review cases, and links/references to screenshots or incident tickets here. Do not paste passwords, access tokens, Supabase keys, signing credentials or customer-sensitive evidence into this record.
`;

await mkdir(acceptanceDir, { recursive: true });
await writeFile(recordPath, content, 'utf8');

console.log(`Android acceptance record created: ${path.relative(root, recordPath)}`);
console.log(`Release source commit: ${metadata.sourceCommit}`);
console.log(`APK SHA-256: ${actualHash}`);
console.log(`Device: ${manufacturer} ${model} (${serial}), Android ${androidVersion} / API ${apiLevel}`);
console.log('Complete every checkbox and mark PASS or FAIL before the release candidate progresses.');
