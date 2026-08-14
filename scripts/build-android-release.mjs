import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const keystoreProperties = path.join(root, 'android', 'keystore.properties');

if (!existsSync(keystoreProperties)) {
  throw new Error('android/keystore.properties is required for a signed release bundle. Copy android/keystore.properties.example and keep the real signing file out of Git.');
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const prepare = spawnSync(npmCommand, ['run', 'mobile:sync'], { cwd: root, stdio: 'inherit' });
if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const androidDir = path.join(root, 'android');
const command = process.platform === 'win32' ? 'gradlew.bat' : 'bash';
const args = process.platform === 'win32' ? ['bundleRelease'] : ['./gradlew', 'bundleRelease'];
const bundle = spawnSync(command, args, { cwd: androidDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

console.log('Android release bundle created under android/app/build/outputs/bundle/release/.');
