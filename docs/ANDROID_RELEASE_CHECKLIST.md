# Android Release Checklist

This checklist separates repository-complete work from items that require Dallmayr distribution credentials, approved branding, legal/compliance ownership or representative field hardware.

## Repository-ready

- [x] Android is the first native distribution target.
- [x] Capacitor production uses a local field bundle instead of a default hosted `server.url`.
- [x] Field app is restricted to technician and road-technician roles.
- [x] Assigned service jobs are cached on-device after a successful online refresh.
- [x] Machine verification works from live camera, photo or manual code entry.
- [x] Verified closures and optional evidence photos are saved to a durable offline outbox before network submission.
- [x] Reconnect sync rechecks the live assignment/status and uses `complete_assigned_service_job`.
- [x] Sync conflicts remain visible for review.
- [x] Android compile and target SDK are API 36.
- [x] Broad photo-library permission is removed.
- [x] Android application backups are disabled.
- [x] Upload keystore and signing properties are excluded from Git.
- [x] Release AAB build command and version overrides are documented.
- [x] Native/mobile readiness is enforced in CI.
- [x] Release preflight rejects accidental `CAPACITOR_SERVER_URL` live-reload packaging.
- [x] Release preflight validates signing properties, the referenced upload keystore, generated runtime configuration, scanner runtime and Android version values before Gradle builds release packages.
- [x] One release build produces the Google Play AAB and a signed release APK for direct physical-device acceptance.
- [x] Release builds persist SHA-256 values for both packages in `android/app/build/outputs/release-checksums.sha256`.
- [x] Release builds require a clean Git source tree and persist the exact source commit, version and package hashes in `android/app/build/outputs/release-metadata.json`.
- [x] The device-install helper verifies the APK against both checksum and release metadata, requires an authorized ADB device, confirms `za.co.dallmayr.erp` is installed and checks the installed version code/name.
- [x] The acceptance-record helper captures the exact release source commit, APK/AAB hashes, installed app version, device model, Android/API level and a standalone PASS/FAIL checklist for each representative handset run.

## Dallmayr-owned release inputs

These cannot be safely fabricated or committed by the application repository.

- [ ] Confirm the final Android application name displayed in Google Play.
- [ ] Provide/approve the final high-resolution app icon and splash artwork.
- [ ] Create the Google Play Console application under the correct Dallmayr legal entity.
- [ ] Enable Play App Signing and create/store the upload keystore in the organisation's credential vault.
- [ ] Populate local `android/keystore.properties` from the upload-key credentials.
- [ ] Confirm the production package ID `za.co.dallmayr.erp` before the first Play release; changing it later creates a different app.
- [ ] Approve the public privacy policy and host it on an HTTPS URL controlled by Dallmayr.
- [ ] Complete Google Play Data Safety answers from `MOBILE_PRIVACY_DATA_INVENTORY.md`.
- [ ] Complete content rating, target audience, ads declaration and app-access instructions in Play Console.
- [ ] Prepare store listing copy, support email/website and screenshots.
- [ ] Decide whether distribution starts as Internal testing, Closed testing or a managed/private enterprise release.

## Device acceptance

Before moving beyond internal testing, run the **signed release APK** on representative field hardware and verify:

- [ ] Fresh online sign-in for technician and road-technician accounts.
- [ ] Rejection of a non-field role.
- [ ] Assigned-job refresh and local cache timestamp.
- [ ] Cold-launch while offline after a successful authorized session.
- [ ] Live camera barcode/QR scan.
- [ ] Scan from photo.
- [ ] Manual machine code fallback.
- [ ] Incorrect machine code blocks closure.
- [ ] Correct machine code permits local closure save.
- [ ] Closure without photo queues offline.
- [ ] Closure with camera evidence photo queues offline.
- [ ] App/process restart retains queued closure and cached jobs.
- [ ] Reconnect automatically syncs a valid queued closure.
- [ ] Reassigned/closed job becomes Needs review instead of disappearing.
- [ ] Synced closure appears correctly in the hosted ERP and audit history.
- [ ] Sign-out is blocked while unsynced closures remain.
- [ ] Sign-out clears cached jobs after the outbox is empty.
- [ ] Android permission prompts match the privacy/store disclosures.

Do not rely on an informal test note. Generate one acceptance record per representative device with `npm run mobile:acceptance:android:record` and complete every checkbox plus PASS/FAIL. Each record is pre-populated with source commit, release hashes, device model, Android/API level and installed app version.

## Release build

Local prerequisites:

- Node.js 22
- Git with a clean working tree for tracked/untracked source files
- Android Studio / current Android SDK
- Android SDK Platform-Tools (`adb`) for direct device installation
- JDK compatible with the current Capacitor Android toolchain
- production `.env.local` or environment values for Supabase public configuration
- `android/keystore.properties`
- upload keystore outside Git
- `CAPACITOR_SERVER_URL` unset for production packaging

The signing file must contain real values for `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. The referenced upload keystore must exist. Placeholder `CHANGE_ME` credentials are rejected.

Build the signed release candidate:

```bash
npm ci
npm run native:check
npm run mobile:bundle:android
```

`mobile:bundle:android` refuses a dirty Git source tree, captures the exact source commit before native preparation, prepares and syncs the native assets, runs `mobile:release:preflight`, then produces:

```text
android/app/build/outputs/bundle/release/app-release.aab
android/app/build/outputs/apk/release/app-release.apk
android/app/build/outputs/release-checksums.sha256
android/app/build/outputs/release-metadata.json
```

The AAB is the Google Play upload package. The signed APK is for controlled direct installation on representative field hardware before Play rollout. `release-metadata.json` binds those package hashes to the exact Git source commit, package ID and Android version code/name used for the release candidate.

For preflight troubleshooting without building the release packages:

```bash
npm run mobile:sync
npm run mobile:release:preflight
```

## Install the exact release candidate on a test device

Enable Developer options and USB debugging on the Android test handset, connect it by USB, and authorize the development computer. Then run:

```bash
npm run mobile:install:android:release
```

The installer refuses to continue if the release APK, checksum manifest or release metadata is missing; if the SHA-256 does not match both integrity sources; if no authorized device is connected; or if more than one device is connected without an explicit target. After installation it verifies the package ID and installed version code/name against the build-time release metadata.

When several devices are attached, select the intended device with `ANDROID_SERIAL`.

PowerShell example:

```powershell
$env:ANDROID_SERIAL="DEVICE_SERIAL"
npm run mobile:install:android:release
```

Bash example:

```bash
ANDROID_SERIAL="DEVICE_SERIAL" npm run mobile:install:android:release
```

If replacement fails because a previous debug build was signed with a different key (or because the installed version code is newer), the helper stops and **does not uninstall the existing app**. Before any manual uninstall, confirm that the current installation has no unsynced closures or evidence because uninstalling Android application data would erase that local outbox.

## Create the device acceptance record

After the exact signed release candidate is installed, generate the acceptance record before starting the test sequence:

```bash
npm run mobile:acceptance:android:record
```

If multiple devices are attached, use the same `ANDROID_SERIAL` selection shown above. Optionally prefill the tester field:

```powershell
$env:ACCEPTANCE_TESTER="Tester Name"
npm run mobile:acceptance:android:record
```

The command verifies the APK hash again, verifies the installed version against `release-metadata.json`, reads device/Android information from ADB, and creates a timestamped Markdown record under:

```text
android/app/build/outputs/acceptance/
```

Complete the checklist in that record and mark exactly one final result: PASS or FAIL. Keep the completed record with the controlled release evidence for that candidate. Do not commit customer-sensitive evidence, passwords, tokens, signing credentials or other secrets into the repository.

## CI versus field-test packages

The normal GitHub CI Android job is a compile/readiness gate and uses a non-production placeholder native key. **Do not use that debug CI build for technician acceptance or production testing.** Field acceptance must use the locally generated, preflight-validated signed release APK described above.

The repository is currently public, so signed internal Dallmayr release packages and completed device acceptance records should not be published as ordinary public-repository workflow artifacts. Keep them in the controlled release workspace or an organisation-approved private evidence/distribution channel.

Increment `DALLMAYRERP_ANDROID_VERSION_CODE` for every Play upload. Keep `DALLMAYRERP_ANDROID_VERSION_NAME` aligned with the human release version. The preflight accepts the documented defaults `1` and `1.0.0` for the first release candidate when the environment overrides are not set.
