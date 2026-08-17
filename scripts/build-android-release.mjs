import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
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
const args = process.platform === 'win32' ? ['bundleRelease'] : ['./gradlew', 'bundleRelease'];
const bundle = spawnSync(command, args, { cwd: androidDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

const bundlePath = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
if (!existsSync(bundlePath)) {
  throw new Error(`Gradle completed but the expected Android App Bundle was not found at ${path.relative(root, bundlePath)}.`);
}

const digest = await sha256(bundlePath);
console.log(`Android release bundle: ${path.relative(root, bundlePath)}`);
console.log(`SHA-256: ${digest}`);
