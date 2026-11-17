export type FirmwareManifest = {
  target: 'esp32s3-n16r8';
  version: string;
  generation: number;
  size: number;
  sha256: string;
  signature: string;
};
export function parseFirmwareManifest(value: unknown): FirmwareManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('A signed firmware manifest is required.');
  const v = value as Record<string, unknown>;
  if (
    v.target !== 'esp32s3-n16r8' ||
    typeof v.version !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(v.version) ||
    typeof v.generation !== 'number' ||
    !Number.isSafeInteger(v.generation) ||
    v.generation < 1 ||
    v.generation > 2147483647 ||
    typeof v.size !== 'number' ||
    !Number.isSafeInteger(v.size) ||
    v.size < 1 ||
    v.size > 6291456 ||
    typeof v.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.sha256) ||
    typeof v.signature !== 'string' ||
    !/^[a-f0-9]{136,144}$/.test(v.signature) ||
    v.signature.length % 2 !== 0
  ) {
    throw new Error(
      'Invalid firmware target, version, generation, size, SHA-256 or DER signature.',
    );
  }
  return {
    target: v.target,
    version: v.version,
    generation: v.generation,
    size: v.size,
    sha256: v.sha256,
    signature: v.signature,
  };
}
export function canonicalFirmwareManifest(
  v: Omit<FirmwareManifest, 'signature'>,
) {
  return `DALLMAYR-OTA-1\n${v.target}\n${v.generation}\n${v.version}\n${v.size}\n${v.sha256}\n`;
}
