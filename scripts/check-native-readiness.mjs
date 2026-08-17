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
  releasePreflight,
  releaseBuilder,
  releaseInstaller,
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
  text('scripts/check-android-release-preflight.mjs'),
  text('scripts/build-android-release.mjs'),
  text('scripts/install-android-release.mjs'),
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
assert.ok(packageJson.scripts['mobile:release:preflight'], 'package.json must expose mobile:release:preflight.');
assert.ok(packageJson.scripts['mobile:bundle:android'], 'package.json must expose the signed Android bundle command.');
assert.ok(packageJson.scripts['mobile:install:android:release'], 'package.json must expose the signed Android device install command.');
assert.ok(packageJson.scripts['native:check'], 'package.json must expose native:check.');

assert.match(releasePreflight, /CAPACITOR_SERVER_URL/, 'Release preflight must reject live-reload server configuration.');
assert.match(releasePreflight, /keystore\.properties/, 'Release preflight must validate Android signing properties.');
assert.match(releasePreflight, /CHANGE_ME/, 'Release preflight must reject placeholder signing credentials.');
assert.match(releasePreflight, /runtime-config\.js/, 'Release preflight must validate the exact generated runtime configuration.');
assert.match(releasePreflight, /html5-qrcode\.min\.js/, 'Release preflight must validate the packaged scanner runtime.');
assert.match(releasePreflight, /DALLMAYRERP_ANDROID_VERSION_CODE/, 'Release preflight must validate the Android version code.');
assert.match(releaseBuilder, /mobile:release:preflight/, 'Signed Android builds must execute the release preflight.');
assert.match(releaseBuilder, /bundleRelease[\s\S]*assembleRelease|assembleRelease[\s\S]*bundleRelease/, 'Signed Android release builds must produce both the Play AAB and direct-test APK.');
assert.match(releaseBuilder, /app-release\.aab/, 'Signed Android builds must verify the Play AAB output.');
assert.match(releaseBuilder, /app-release\.apk/, 'Signed Android builds must verify the release APK output.');
assert.match(releaseBuilder, /release-checksums\.sha256/, 'Signed Android builds must persist an integrity manifest for release outputs.');
assert.match(releaseInstaller, /ANDROID_SERIAL/, 'Device acceptance install must support explicit Android device selection.');
assert.match(releaseInstaller, /install['"],\s*['"]-r['"]/, 'Device acceptance install must replace-install the verified signed APK.');
assert.match(releaseInstaller, /release-checksums\.sha256/, 'Device acceptance install must verify the APK against the release checksum manifest.');
assert.match(releaseInstaller, /za\.co\.dallmayr\.erp/, 'Device acceptance install must verify the production Android package ID.');

assert.match(nativeDocs, /Android-first/i, 'Native documentation must record the Android-first product decision.');
assert.match(nativeDocs, /locally bundled/i, 'Native documentation must describe the local field bundle architecture.');

console.log('Native/mobile readiness contracts passed: Android field bundle, offline queue, API 36, scoped permissions, signing hygiene, release preflight and device-test packaging are staged.');
