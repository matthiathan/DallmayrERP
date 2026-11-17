import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalFirmwareManifest,
  parseFirmwareManifest,
} from '../../supabase/functions/_shared/firmware-manifest.ts';
const release = {
  target: 'esp32s3-n16r8',
  version: '6.8.53',
  generation: 53,
  size: 123456,
  sha256: 'a'.repeat(64),
  signature: '30'.repeat(70),
};
test('firmware signature binds target, generation, version, size and checksum', () => {
  assert.equal(
    canonicalFirmwareManifest(parseFirmwareManifest(release)),
    `DALLMAYR-OTA-1\nesp32s3-n16r8\n53\n6.8.53\n123456\n${'a'.repeat(64)}\n`,
  );
  assert.notEqual(
    canonicalFirmwareManifest(release),
    canonicalFirmwareManifest({ ...release, generation: 54 }),
  );
});
test('rejects ambiguous, oversized, injected and wrong-target firmware manifests', () => {
  for (const patch of [
    { generation: 0 },
    { generation: 1.5 },
    { generation: '53' },
    { size: 0 },
    { size: 7000000 },
    { version: 'x\ny' },
    { sha256: 'f' },
    { target: 'esp32' },
    { signature: '00' },
  ]) {
    assert.throws(() => parseFirmwareManifest({ ...release, ...patch }));
  }
});

test('offline signer binds an image checksum and creates a verifiable P-256 signature', async () => {
  const { generateKeyPairSync, verify, createHash } = await import(
    'node:crypto'
  );
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'dallmayr-sign-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const image = Buffer.from('known test image bytes');
    await writeFile(join(dir, 'app.bin'), image);
    await writeFile(
      join(dir, 'key.pem'),
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/sign-telemetry-firmware.mjs',
        join(dir, 'app.bin'),
        '6.8.53',
        '53',
        join(dir, 'key.pem'),
        join(dir, 'release.json'),
      ],
      { cwd: new URL('../../', import.meta.url), stdio: 'pipe' },
    );
    const manifest = parseFirmwareManifest(
      JSON.parse(await readFile(join(dir, 'release.json'), 'utf8')),
    );
    assert.equal(
      manifest.sha256,
      createHash('sha256').update(image).digest('hex'),
    );
    assert.equal(
      verify(
        'sha256',
        Buffer.from(canonicalFirmwareManifest(manifest)),
        publicKey,
        Buffer.from(manifest.signature, 'hex'),
      ),
      true,
    );
    assert.equal(
      verify(
        'sha256',
        Buffer.from(canonicalFirmwareManifest({ ...manifest, generation: 54 })),
        publicKey,
        Buffer.from(manifest.signature, 'hex'),
      ),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
