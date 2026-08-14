# Android Release Checklist

This checklist separates repository-complete work from items that require Dallmayr distribution credentials, approved branding or legal/compliance ownership.

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

Before moving beyond internal testing, run the signed build on representative field hardware and verify:

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

## Release build

Local prerequisites:

- Node.js 22
- Android Studio / current Android SDK
- JDK compatible with the current Capacitor Android toolchain
- production `.env.local` or environment values for Supabase public configuration
- `android/keystore.properties`
- upload keystore outside Git

Build:

```bash
npm ci
npm run native:check
npm run mobile:bundle:android
```

Increment `DALLMAYRERP_ANDROID_VERSION_CODE` for every Play upload. Keep `DALLMAYRERP_ANDROID_VERSION_NAME` aligned with the human release version.
