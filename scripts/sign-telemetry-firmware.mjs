import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import {
  canonicalFirmwareManifest,
  parseFirmwareManifest,
} from '../supabase/functions/_shared/firmware-manifest.ts';
// node --experimental-strip-types scripts/sign-telemetry-firmware.mjs app.bin version generation private-key.pem manifest.json
const [imagePath, version, generation, keyPath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw new Error(
    'Usage: app.bin version generation private-key.pem manifest.json',
  );
const image = await readFile(imagePath);
const key = createPrivateKey(await readFile(keyPath));
if (
  key.asymmetricKeyType !== 'ec' ||
  key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
)
  throw new Error('Use an ECDSA P-256 release-signing key.');
const unsigned = {
  target: 'esp32s3-n16r8',
  version,
  generation: Number(generation),
  size: image.length,
  sha256: createHash('sha256').update(image).digest('hex'),
};
const signature = sign(
  'sha256',
  Buffer.from(canonicalFirmwareManifest(unsigned)),
  key,
).toString('hex');
const manifest = parseFirmwareManifest({ ...unsigned, signature });
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  `Signed ${manifest.version}, generation ${manifest.generation}; private key was not copied.`,
);
