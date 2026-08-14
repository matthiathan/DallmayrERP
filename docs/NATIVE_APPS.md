# Native App Packaging

DallmayrERP now uses two native product paths instead of treating every platform as the same hosted shell.

## Product decision

**Android-first field product:** Android packages a **locally bundled field application** for technicians and road technicians. Its supported native workflow is intentionally narrow: authenticate, cache assigned service jobs, verify machines by camera/photo/manual barcode, capture closure notes/photos, queue closures offline, and sync them through the existing controlled Supabase RPC when connectivity returns.

**Hosted full ERP:** the browser application remains the source of truth for the complete ERP. Electron continues to wrap the hosted application for desktop users. The full ERP is not being duplicated into a second native codebase.

**iOS:** deferred for now. Capacitor iOS foundations remain in the repository and can later package the same field bundle after the Android field product has been proven operationally.

This architecture gives field staff a real local/offline core without forcing every dynamic Next.js ERP route into a static native bundle.

## Android field architecture

- App ID: `za.co.dallmayr.erp`
- App name: `DallmayrERP Field`
- Local Capacitor web root: `native/mobile/www`
- Backend: existing Supabase project and existing RLS/RPC contracts
- Supported roles: `technician`, `road_technician`
- Minimum Android: API 24
- Compile/target Android: API 36
- Scanner runtime: the existing `html5-qrcode` dependency copied into the native bundle during preparation
- Offline storage: IndexedDB inside the app sandbox
- Offline authorization: last successful field-role/profile authorization may be reused for up to 24 hours while offline
- Offline jobs: the last successfully refreshed assigned queue is cached per business user
- Offline closure: machine-verified closures and optional evidence photos are stored in a durable outbox before any network submission
- Reconnect: queued closures are re-authorized against the live assigned service job and then submitted through `complete_assigned_service_job`
- Conflict handling: a reassigned, closed or otherwise changed server job is marked **Needs review** rather than silently discarded

The Android field client does not widen any server permission. Supabase RLS and the closure RPC remain authoritative whenever records are loaded or synced.

## Capacitor configuration

Production Capacitor builds use the local `webDir`. A remote `server.url` is only enabled when `CAPACITOR_SERVER_URL` is explicitly set for development/live reload.

Prepare the local field bundle:

```bash
npm ci
npm run mobile:prepare
```

`mobile:prepare` reads `.env.local`, `.env`, or the process environment for:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_APP_URL                # optional; hosted ERP reference only
```

The public Supabase anon key is written into the generated `native/mobile/www/runtime-config.js`. That generated file and the copied scanner vendor bundle are ignored by Git.

Sync and open Android Studio:

```bash
npm run mobile:sync
npm run mobile:open:android
```

Run on a connected Android device/emulator:

```bash
npm run mobile:run:android
```

## Android release bundle

Release signing is configuration-driven and no keystore secrets belong in the repository.

1. Copy `android/keystore.properties.example` to `android/keystore.properties`.
2. Point `storeFile` to the Google Play upload keystore and fill the passwords/alias locally.
3. Set release version values when needed:

```text
DALLMAYRERP_ANDROID_VERSION_CODE=1
DALLMAYRERP_ANDROID_VERSION_NAME=1.0.0
```

4. Build the signed Android App Bundle:

```bash
npm run mobile:bundle:android
```

Expected output:

```text
android/app/build/outputs/bundle/release/
```

The repository deliberately does not contain the real upload keystore, signing passwords or Google Play credentials.

## Android permissions

The field client requests:

- `INTERNET` for Supabase synchronization
- `CAMERA` for live machine/barcode scanning

Camera hardware is optional because manual code entry and scan-from-photo remain available.

The app does **not** request broad Android photo-library access. Evidence photos are user-selected/captured through the system file/camera flow.

Android backups are disabled because the field bundle can hold cached authenticated operational records and an offline closure outbox.

## Desktop / Electron

Electron remains a hosted full-ERP shell:

```bash
npm run desktop:dev
npm run desktop:package
npm run desktop:make
```

The desktop wrapper retains context isolation, sandboxing, restricted permissions, origin controls and its local offline error page. Windows signing and macOS signing/notarization still require the organisation's distribution credentials.

## iOS

iOS is not the current release priority. The Capacitor iOS commands remain available and will use the same local field bundle when the Android field workflow is accepted:

```bash
npm run mobile:add:ios
npm run mobile:sync
npm run mobile:open:ios
npm run mobile:run:ios
```

Formal iOS distribution still requires macOS/Xcode, Apple signing, final assets and App Store privacy review.

## Readiness checks

Run:

```bash
npm run native:check
```

The native contract check enforces the local field bundle decision, API 36 target, Android permission scope, signing-file hygiene, offline queue presence and release documentation.

See `docs/ANDROID_RELEASE_CHECKLIST.md` and `docs/MOBILE_PRIVACY_DATA_INVENTORY.md` for the remaining organisation-owned release inputs.
