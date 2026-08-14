import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const keystoreProperties = path.join(root, 'android', 'keystore.properties');

if (!existsSync(keystoreProperties)) {
  throw new Error(
    'android/keystore.properties is required for a signed release bundle. Copy android/keystore.properties.example, point it at the upload keystore, and keep the real file out of Git.',
  );
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const prepare = spawnSync(npmCommand, ['run', 'mobile:sync'], {
  cwd: root,
  stdio: 'inherit',
});
if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const bundle = spawnSync(gradleCommand, ['bundleRelease'], {
  cwd: path.join(root, 'android'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

console.log('Android release bundle created under android/app/build/outputs/bundle/release/.');
