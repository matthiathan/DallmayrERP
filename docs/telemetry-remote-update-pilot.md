# Cellular-first telemetry and remote-update pilot

## Delivery state

V6.8.53 adds cellular-first backend routing with Wi-Fi fallback and two successful
cellular probes a minute apart before returning to uninterrupted cellular use.
The modem stays available while Wi-Fi is connected. Legacy cached Wi-Fi-first
preferences cannot override this rule. Heartbeats are scheduled every minute.

The migration makes reported serial/asset identity a suggestion, preserves existing
assignments, and requires an active Administrator for machine assignment changes.
New devices are unmapped, including devices enrolled using a pre-paired token.
The existing machine-link action remains the final assignment operation.

Administrator-controlled remote updates use an immutable private Storage image,
a P-256 signed manifest, a region/device-scoped request, SHA-256 streaming checks,
an inactive app slot and a rollback-enabled bootloader. The private signing key
never belongs in the portal, backend, device, repository or diagnostics.
The device independently refuses OTA unless rollback support and trust anchors
are present. A standard Arduino build with rollback disabled is a bootstrap
build for USB commissioning, not proof of automatic rollback support.

## One-time preparation

1. Apply the migration to a disposable/local test stack and deploy matching
   `telemetry-config` and `telemetry-ingest` functions. Deploy these together;
   old firmware may still use old transport policy until replaced.
2. Generate an ECDSA P-256 key using OpenSSL on a trusted administrator machine:

   ```sh
   openssl ecparam -name prime256v1 -genkey -noout -out release-private.pem
   openssl pkey -in release-private.pem -pubout -out release-public.pem
   ```

   Back up the private file securely outside the repository. Do not upload it.
3. Obtain the trusted CA root(s) for the existing Supabase HTTPS endpoint and
   configure **public** trust anchors:

   ```sh
   node scripts/configure-telemetry-ota-trust.mjs release-public.pem root-ca.pem
   npm run firmware:generate:v653
   ```

   The trusted HTTPS path needs a valid device clock; firmware starts SNTP.
   Commission it on a network where time synchronization works before OTA testing.
4. Build the ESP32-S3 N16R8 firmware **and bootloader** using matching ESP-IDF /
   Arduino framework artifacts with `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`.
   Include `otadata` and two application slots large enough for the application.
   `firmware/ota/sdkconfig.defaults` and `partitions.csv` record the required
   layout. Arduino IDE's prebuilt bootloader is not changed by sketch macros or
   selecting a partition menu entry. The stock CI compile checks C++ compatibility;
   it does not produce a proven rollback-enabled release. A reproducible custom
   bootloader/framework build and physical rollback evidence remain release gates.

   A pinned ESP-IDF component project is included. After generating the sketch,
   compile it once with Arduino CLI to obtain its generated C++/prototypes, then:

   ```sh
   node scripts/prepare-telemetry-idf.mjs /path/to/arduino-build
   idf.py -C firmware/ota set-target esp32s3
   idf.py -C firmware/ota build
   ```

   Install ESP-IDF 5.5.5 first; managed dependencies pin Arduino 3.3.12 and
   ArduinoJson 7.3.2. This component build recipe has not been executed in this
   workspace. Inspect the generated sdkconfig for rollback and the custom
   partitions before USB flashing; validate the resulting bootloader physically.
5. Install that initial bootstrap, matching bootloader and partition layout over
   USB. **Back up and preserve NVS device credentials and counters.** Do not erase
   flash or remotely change bootloader, partitions or NVS to install an update.
6. In Device Management, register the hardware UID as an unmapped device. Paste
   the one-time `DEVICE PROVISION ...` command into Serial Monitor over USB.
   Only a hash is stored on the server. The device refuses a mismatched UID or
   replacement of already installed credentials. Existing enrolled units retain
   their credentials and need no new provisioning.
7. Check a fresh heartbeat reports rollback capability and configured trust.
   Verify the device is Online / Unmapped, then confirm its machine in the portal.

## Remote installation and restoring an older application

Use the application `.bin`, not a merged full-flash image. Sign the exact bytes:

```sh
node --experimental-strip-types scripts/sign-telemetry-firmware.mjs \
  application.bin 6.8.53 53 release-private.pem release.json
```

Use Node 22.18+ or Node 24 for the signing command. Upload the `.bin` and signed
`.json` in the portal, then explicitly request installation for one device.
The portal checks selected bytes against the manifest; release registration records
administrator-supplied metadata, while the device authoritatively verifies the signature
before opening its inactive slot. Target, generation, version, size and checksum
are signed together. A redirect, wrong origin, truncated transfer, bad checksum,
invalid ESP image or untrusted signature must leave the current boot selection
unchanged. A newer signed generation prevents replay of confirmed old releases.

To remotely restore a known-good older application, sign its original binary with
a **new higher generation**, register it and request installation. This requires
that older application to retain the compatible update/rollback support. A failed
trial automatically falls back to the previously working slot without an admin
having to reach the failing application.

The trial is confirmed only after at least one minute of runtime, two acknowledged
heartbeats, minimum free heap and an enabled machine interface when configured.
If it does not pass within five minutes, it requests rollback. A reset/crash
before confirmation is handled by the rollback-enabled bootloader. During trial the application task is subscribed to a two-minute panic watchdog.
A verified watchdog reset on the physical board remains part of pilot acceptance.

The update history distinguishes requested, installing, awaiting health, healthy,
failed, rejected and rolled back. A successful download alone is not success.
A failed install is not silently retried: submit a new explicit request after
reviewing the reason. The private storage bucket and existing backend are reused;
no paid service or separate database is introduced. Image downloads consume SIM
and existing hosting/storage allowances; actual rollout usage must fit those
allowances before rollout to satisfy the no-extra-cost constraint.

## Verification and remaining work

Automated checks cover routing timing/wraparound, manifest validation, real
Postgres-compatible execution of the new migration and public RPCs, authorization,
admin finality, generation checks and update request transitions, plus rendered
capability warnings. They do not prove physical electrical safety or modem,
flash power-cut, bootloader and rollback operation.

Required physical pilot cases:

- Both networks available: cellular used; no cellular backend: Wi-Fi fallback;
  restore cellular: spaced successful probes followed by cellular primary.
- New device provisioned before installation: no field enrollment window, visible
  unmapped; identity suggestions never change an administrator assignment.
- Unsigned/tampered image, wrong target, older generation and truncated download:
  reject and retain current firmware/data.
- Cut power during download and during trial; test a crash and a watchdog hang
  before confirmation; previous firmware resumes with NVS intact.
- Healthy trial acknowledges and stays installed; remotely restore a re-signed
  known-good application with a higher generation.
- Actual vends continue while downloading; measure input queue overruns and report
  any lost observations before approving update while a machine is trading.

The wider approved agreement remains in `telemetry-device-agreement-20261117.md`.
Durable fault-event buffering, effective-time assignment history, original-period
sales replay, exact five-minute heartbeat-only portal status, complete diagnostic
export and acceptance across machine models are outstanding work, not delivered
by these three changes. Do not describe this branch as full fleet readiness.

Official rollback reference:
https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/ota.html

## Recorded local validation

- 404 Node tests passed, including embedded PostgreSQL migration/RPC execution,
  signed-manifest and rendered capability tests.
- Native C++ transport and OTA boot-recovery policy harnesses passed.
- TypeScript, RPC contracts, source safety, style ownership and dialog accessibility
  checks passed; the Next.js production build passed.
- Generated V6.8.53 compiled using Arduino-ESP32 3.3.12 and ArduinoJson 7.3.2
  for ESP32-S3 N16R8. The stock Arduino compile reported 1,180,331 bytes of
  application storage and 121,596 bytes of globals. It still reports inherited
  MDB/NMEA warnings. That stock binary has OTA rollback disabled by its framework.
- ESP-IDF preparation successfully produced the generated component input from
  that build. The custom rollback-enabled component build was not executed.
- Full-browser smoke was attempted with API fixtures but the workspace refused
  Chromium's socket operation; no browser-interaction or screenshot result is
  claimed. The rendered status tests and application build passed independently.
- No production database/function deployment, device flash, physical vend,
  power-cut or hardware rollback test was performed.
