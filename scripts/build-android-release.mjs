import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(script) {
  const result = spawnSync(npmCommand, ['run', script], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

// Sync first so the preflight validates the exact generated runtime assets that Gradle will package.
runNpm('mobile:sync');
runNpm('mobile:release:preflight');

const androidDir = path.join(root, 'android');
const command = process.platform === 'win32' ? 'gradlew.bat' : 'bash';
const args = process.platform === 'win32'
  ? ['bundleRelease', 'assembleRelease']
  : ['./gradlew', 'bundleRelease', 'assembleRelease'];
const releaseBuild = spawnSync(command, args, { cwd: androidDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (releaseBuild.status !== 0) process.exit(releaseBuild.status ?? 1);

const bundlePath = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const checksumPath = path.join(androidDir, 'app', 'build', 'outputs', 'release-checksums.sha256');

for (const [label, filePath] of [
  ['Android App Bundle', bundlePath],
  ['signed Android release APK', apkPath],
]) {
  if (!existsSync(filePath)) {
    throw new Error(`Gradle completed but the expected ${label} was not found at ${path.relative(root, filePath)}.`);
  }
}

const [bundleDigest, apkDigest] = await Promise.all([sha256(bundlePath), sha256(apkPath)]);
await mkdir(path.dirname(checksumPath), { recursive: true });
await writeFile(
  checksumPath,
  `${bundleDigest}  bundle/release/app-release.aab\n${apkDigest}  apk/release/app-release.apk\n`,
  'utf8',
);

console.log(`Android Play bundle: ${path.relative(root, bundlePath)}`);
console.log(`AAB SHA-256: ${bundleDigest}`);
console.log(`Android device-test APK: ${path.relative(root, apkPath)}`);
console.log(`APK SHA-256: ${apkDigest}`);
console.log(`Release checksum manifest: ${path.relative(root, checksumPath)}`);
