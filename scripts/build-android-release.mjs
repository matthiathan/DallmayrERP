import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageId = 'za.co.dallmayr.erp';

function runNpm(script) {
  const result = spawnSync(npmCommand, ['run', script], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw new Error('Git is required to create an auditable Android release candidate.');
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed.`);
  return String(result.stdout).trim();
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

// Capture source identity before native preparation. Release packages must be reproducibly attributable
// to one committed source tree; ignored local configuration/signing files do not make the tree dirty.
const sourceCommit = git(['rev-parse', 'HEAD']);
const sourceStatus = git(['status', '--porcelain', '--untracked-files=all']);
if (sourceStatus) {
  throw new Error(
    'Android release candidates must be built from a clean Git working tree so the produced APK/AAB can be tied to one exact source commit. Commit, stash or remove local source changes and retry.',
  );
}

const versionCode = Number(process.env.DALLMAYRERP_ANDROID_VERSION_CODE ?? '1');
const versionName = String(process.env.DALLMAYRERP_ANDROID_VERSION_NAME ?? '1.0.0').trim();

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
const outputsDir = path.join(androidDir, 'app', 'build', 'outputs');
const checksumPath = path.join(outputsDir, 'release-checksums.sha256');
const metadataPath = path.join(outputsDir, 'release-metadata.json');

for (const [label, filePath] of [
  ['Android App Bundle', bundlePath],
  ['signed Android release APK', apkPath],
]) {
  if (!existsSync(filePath)) {
    throw new Error(`Gradle completed but the expected ${label} was not found at ${path.relative(root, filePath)}.`);
  }
}

const [bundleDigest, apkDigest] = await Promise.all([sha256(bundlePath), sha256(apkPath)]);
await mkdir(outputsDir, { recursive: true });
await writeFile(
  checksumPath,
  `${bundleDigest}  bundle/release/app-release.aab\n${apkDigest}  apk/release/app-release.apk\n`,
  'utf8',
);

const releaseMetadata = {
  schemaVersion: 1,
  packageId,
  versionCode,
  versionName,
  sourceCommit,
  sourceTreeClean: true,
  builtAt: new Date().toISOString(),
  aab: {
    path: 'bundle/release/app-release.aab',
    sha256: bundleDigest,
  },
  apk: {
    path: 'apk/release/app-release.apk',
    sha256: apkDigest,
  },
};
await writeFile(metadataPath, `${JSON.stringify(releaseMetadata, null, 2)}\n`, 'utf8');

console.log(`Android Play bundle: ${path.relative(root, bundlePath)}`);
console.log(`AAB SHA-256: ${bundleDigest}`);
console.log(`Android device-test APK: ${path.relative(root, apkPath)}`);
console.log(`APK SHA-256: ${apkDigest}`);
console.log(`Release source commit: ${sourceCommit}`);
console.log(`Release checksum manifest: ${path.relative(root, checksumPath)}`);
console.log(`Release metadata: ${path.relative(root, metadataPath)}`);
