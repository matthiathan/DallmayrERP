import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

async function text(path) {
  return readFile(path, 'utf8');
}

const [
  capacitorConfig,
  manifest,
  variables,
  androidGitignore,
  mobileGitignore,
  fieldHtml,
  fieldJs,
  packageJsonSource,
  nativeDocs,
] = await Promise.all([
  text('capacitor.config.ts'),
  text('android/app/src/main/AndroidManifest.xml'),
  text('android/variables.gradle'),
  text('android/.gitignore'),
  text('native/mobile/.gitignore'),
  text('native/mobile/www/index.html'),
  text('native/mobile/www/field-app.js'),
  text('package.json'),
  text('docs/NATIVE_APPS.md'),
]);

assert.match(capacitorConfig, /CAPACITOR_SERVER_URL/, 'Capacitor live-reload URL must be opt-in.');
assert.doesNotMatch(
  capacitorConfig,
  /server:\s*\{[\s\S]{0,300}(dallmayrerp\.onrender\.com|NEXT_PUBLIC_APP_URL)/,
  'Production Capacitor config must not default to the hosted ERP server.',
);
assert.match(capacitorConfig, /webDir:\s*['"]native\/mobile\/www['"]/, 'Capacitor must package the local field webDir.');

assert.match(variables, /compileSdkVersion\s*=\s*36/, 'Android compile SDK must remain API 36.');
assert.match(variables, /targetSdkVersion\s*=\s*36/, 'Android target SDK must remain API 36.');

assert.match(manifest, /android\.permission\.CAMERA/, 'Android camera permission is required for field scanning.');
assert.doesNotMatch(manifest, /READ_MEDIA_IMAGES|READ_MEDIA_VIDEO/, 'Broad Android media permissions must not be used for occasional evidence photos.');
assert.match(manifest, /android:allowBackup="false"/, 'Android backups must be disabled for cached ERP field data.');
assert.match(manifest, /android\.hardware\.camera\.any[\s\S]*android:required="false"/, 'Camera hardware must remain optional because manual code entry is supported.');

assert.match(androidGitignore, /\*\.jks/, 'Android upload keystores must be ignored.');
assert.match(androidGitignore, /keystore\.properties/, 'Android signing properties must be ignored.');
assert.match(mobileGitignore, /runtime-config\.js/, 'Generated native runtime config must not be committed.');
assert.match(mobileGitignore, /www\/vendor\//, 'Generated native scanner vendor assets must not be committed.');

assert.doesNotMatch(fieldHtml, /http-equiv=["']refresh["']|dallmayrerp\.onrender\.com/, 'The packaged field entry page must not redirect to the hosted ERP.');
assert.match(fieldHtml, /field-app\.js/, 'The local field application must be packaged.');
assert.match(fieldHtml, /html5-qrcode\.min\.js/, 'The local scanner runtime must be packaged.');
new Script(fieldJs, { filename: 'native/mobile/www/field-app.js' });
assert.match(fieldJs, /indexedDB/, 'Field jobs and closures must have durable offline storage.');
assert.match(fieldJs, /complete_assigned_service_job/, 'Offline sync must converge through the existing controlled closure RPC.');
assert.match(fieldJs, /machineMatches/, 'Field closure must preserve local machine-verification gating.');
assert.match(fieldJs, /ALLOWED_ROLES/, 'The native field client must remain scoped to field roles.');

const packageJson = JSON.parse(packageJsonSource);
assert.ok(packageJson.scripts['mobile:prepare'], 'package.json must expose mobile:prepare.');
assert.ok(packageJson.scripts['mobile:bundle:android'], 'package.json must expose the signed Android bundle command.');
assert.ok(packageJson.scripts['native:check'], 'package.json must expose native:check.');

assert.match(nativeDocs, /Android-first/i, 'Native documentation must record the Android-first product decision.');
assert.match(nativeDocs, /locally bundled/i, 'Native documentation must describe the local field bundle architecture.');

console.log('Native/mobile readiness contracts passed: Android field bundle, offline queue, API 36, scoped permissions and signing hygiene are staged.');
