import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformTelemetryV651 } from './generate-telemetry-v6-8-51.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');
const defaultOutputPath = path.join(root, 'firmware/DallmayrTelemetryV6_8_52/DallmayrTelemetryV6_8_52.ino');

export function transformTelemetryV652(input) {
  const source = transformTelemetryV651(input)
    .replace(
      'Dallmayr South Africa - Telemetry V6.8.51 PASSIVE MDB VEND EVIDENCE + DEX AUDIT RECONCILIATION',
      'Dallmayr South Africa - Telemetry V6.8.52 STABLE MDB PROFILE IDENTITY + DEX AUDIT RECONCILIATION',
    )
    .replace(
      'static const char* FIRMWARE_VERSION = "6.8.51-esp32s3-air780eu-mdb-vend-dex-audit";',
      'static const char* FIRMWARE_VERSION = "6.8.52-esp32s3-air780eu-stable-mdb-profile-fingerprint";',
    );

  if (!source.includes('6.8.52-esp32s3-air780eu-stable-mdb-profile-fingerprint')) {
    throw new Error('V6.8.52 generation failed: firmware version marker missing.');
  }
  if (!/DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/.test(source)) {
    throw new Error('V6.8.52 safety assertion failed: MDB active TX must remain disabled.');
  }
  if (!source.includes('String fingerprint = String("MDB2-")')) {
    throw new Error('V6.8.52 generation failed: stable MDB profile fingerprint schema missing.');
  }
  if (source.includes('seed += String(reader.peripheralSerial)')) {
    throw new Error('V6.8.52 generation failed: per-unit cashless serial leaked into profile fingerprint.');
  }
  if (!source.includes('addCommonPayload(doc, "dex_audit_snapshot")')) {
    throw new Error('V6.8.52 generation failed: DEX reconciliation support missing.');
  }

  return source;
}

export async function generateTelemetryV652(outputPath = defaultOutputPath) {
  const source = await readFile(sourcePath, 'utf8');
  const generated = transformTelemetryV652(source);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  return outputPath;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outputPath = await generateTelemetryV652();
  console.log(`Generated ${path.relative(root, outputPath)}`);
}
