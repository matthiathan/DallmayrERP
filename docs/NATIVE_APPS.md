# Native App Packaging

DallmayrERP uses the hosted Next.js app as the source of truth and wraps it in native shells for desktop and mobile. This keeps the Supabase-backed web app unchanged while we add installable Windows, macOS, Android and iOS targets.

## Architecture

- Web app: `https://dallmayrerp.onrender.com`
- Desktop shell: Electron loads the hosted app in a locked-down browser window.
- Mobile shell: Capacitor loads the hosted app in the native WebView.
- Backend: Supabase remains unchanged.

The app currently has runtime dynamic routes such as `/work/[workItemId]`, `/warehouse/stock/[stockItemId]` and `/operations/assets/[machineId]`. A fully bundled static native app would need a routing refactor first, so the hosted shell path is the fastest reliable native route.

## Environment Variables

Use these when pointing native shells at staging or a local web app:

```powershell
$env:DALLMAYRERP_APP_URL = "http://localhost:3000"
$env:CAPACITOR_SERVER_URL = "http://localhost:3000"
```

Default production URL:

```text
https://dallmayrerp.onrender.com
```

## Desktop

Run the desktop shell:

```bash
npm run desktop:dev
```

Create packaged desktop output:

```bash
npm run desktop:package
npm run desktop:make
```

Windows installers can be made on Windows. Production macOS builds, signing and notarization should be done on macOS.

## Android

Install Android Studio, an Android SDK and a Java 11+ runtime first. Android Studio normally provides a suitable bundled JDK; set `JAVA_HOME` to that JDK before running Gradle if your terminal still points at Java 8.

Then create and sync the native Android project:

```bash
npm run mobile:add:android
npm run mobile:sync
npm run mobile:open:android
```

Run on a connected device or emulator:

```bash
npm run mobile:run:android
```

## iOS

iOS requires macOS, Xcode and Xcode Command Line Tools. On a Mac:

```bash
npm run mobile:add:ios
npm run mobile:sync
npm run mobile:open:ios
```

Run on a simulator or connected device:

```bash
npm run mobile:run:ios
```

## Store Readiness

Before external app-store submission, prepare:

- Final app icons and splash assets for each platform.
- Apple Developer and Google Play signing credentials.
- Windows code-signing certificate if distributing outside Microsoft Store.
- App privacy disclosures for camera, photo upload and authenticated business data.
- A decision on hosted-shell distribution versus a future static/offline-capable native bundle.
