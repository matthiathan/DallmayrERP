import { readFile, writeFile } from 'node:fs/promises';
import { createPublicKey, X509Certificate } from 'node:crypto';
const [publicKeyPath, caPath] = process.argv.slice(2);
if (!publicKeyPath || !caPath)
  throw new Error('Usage: public-key.pem root-ca.pem (public files only)');
const publicPem = await readFile(publicKeyPath, 'utf8'),
  caPem = await readFile(caPath, 'utf8');
if (/PRIVATE KEY/.test(publicPem + caPem))
  throw new Error('Private keys must never be installed on devices.');
const key = createPublicKey(publicPem);
if (
  key.asymmetricKeyType !== 'ec' ||
  key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
)
  throw new Error('An ECDSA P-256 public key is required.');
const certs = caPem.match(
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
);
if (!certs?.length || certs.some((cert) => !new X509Certificate(cert).ca))
  throw new Error('Supply a trusted root CA certificate or CA bundle.');
const path = new URL('../firmware/shared/FirmwareTrust.h', import.meta.url);
await writeFile(
  path,
  `#pragma once\n// Public trust anchors only; release private key stays offline.\nstatic const char DALLMAYR_OTA_PUBLIC_KEY_PEM[] = ${JSON.stringify(publicPem)};\nstatic const char DALLMAYR_OTA_CA_PEM[] = ${JSON.stringify(caPem)};\n`,
);
console.log(
  'Public OTA trust anchors configured. Regenerate and build firmware before USB bootstrap.',
);
