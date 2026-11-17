import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = process.argv[2];
if (!build)
  throw new Error('Pass the completed Arduino V6.8.53 build directory.');
const sketch = path.resolve(
  build,
  'sketch',
  'DallmayrTelemetryV6_8_53.ino.cpp',
);
const source = await readFile(sketch, 'utf8');
if (
  !source.includes('6.8.53-esp32s3-cellular-first-signed-ota') ||
  !source.includes('serviceCellularLbsLocation')
)
  throw new Error(
    'Build does not contain the complete generated V6.8.53 sketch.',
  );
const current = await readFile(
  path.join(
    root,
    'firmware/DallmayrTelemetryV6_8_53/DallmayrTelemetryV6_8_53.ino',
  ),
  'utf8',
);
const marker = current.match(
  /#define DALLMAYR_SOURCE_SHA256 "[a-f0-9]{64}"/,
)?.[0];
if (!marker || !source.includes(marker))
  throw new Error(
    'Arduino build is stale: regenerate and compile the current sketch before preparing ESP-IDF.',
  );
const generated = path.join(root, 'firmware/ota/main/generated');
await mkdir(generated, { recursive: true });
await copyFile(sketch, path.join(generated, 'telemetry.cpp'));
for (const file of await readdir(
  path.join(root, 'firmware/DallmayrTelemetryV6_8_53'),
)) {
  if (file.endsWith('.h'))
    await copyFile(
      path.join(root, 'firmware/DallmayrTelemetryV6_8_53', file),
      path.join(generated, file),
    );
}
console.log(
  'Prepared preprocessed sketch for ESP-IDF 5.5.5 with Arduino 3.3.12. Run idf.py -C firmware/ota set-target esp32s3 build.',
);
