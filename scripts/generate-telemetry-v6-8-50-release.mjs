import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformTelemetryV650 } from './generate-telemetry-v6-8-50.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');
const defaultOutputPath = path.join(root, 'firmware/DallmayrTelemetryV6_8_50/DallmayrTelemetryV6_8_50.ino');

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`V6.8.50 release generator could not find ${label}.`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`V6.8.50 release generator expected exactly one ${label}.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

export function transformTelemetryV650Release(input) {
  let source = transformTelemetryV650(input);

  source = replaceOnce(
    source,
    `  if (command == 0) {\n    if (cashless.vendPending && cashless.vendApproved) {\n      uint32_t scaled = cashless.approvedScaledPrice\n                      ? cashless.approvedScaledPrice\n                      : cashless.requestedScaledPrice;\n      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);\n      mdbRecordVend(cashless.selection, cents, true, "cashless_reset_after_approval");\n    }\n    cashless.vendPending = false;\n    cashless.vendApproved = false;\n    cashless.selection = 0xFFFF;\n    cashless.requestedScaledPrice = 0;\n    cashless.approvedScaledPrice = 0;\n    cashless.enabledFeatureBits = 0;`,
    `  if (command == 0) {\n    if (cashless.vendPending && cashless.vendApproved) {\n      uint32_t scaled = cashless.approvedScaledPrice\n                      ? cashless.approvedScaledPrice\n                      : cashless.requestedScaledPrice;\n      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);\n      if (mdbRecordVend(cashless.selection, cents, true, "cashless_reset_after_approval")) {\n        mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection, cents,\n          MDB_SELECTION_SUCCESS, "cashless_reset_after_approval", cashless.vendCorrelationId, cashless.vendCorrelationOrdinal);\n      }\n    }\n    cashless.vendPending = false;\n    cashless.vendApproved = false;\n    cashless.selection = 0xFFFF;\n    cashless.requestedScaledPrice = 0;\n    cashless.approvedScaledPrice = 0;\n    cashless.vendCorrelationId = 0;\n    cashless.vendCorrelationOrdinal = 0;\n    cashless.enabledFeatureBits = 0;`,
    'MDB reset-after-approval terminal evidence',
  );

  if (!source.includes('MDB_SELECTION_SUCCESS, "cashless_reset_after_approval"')) {
    throw new Error('Generated V6.8.50 release is missing reset-after-approval evidence.');
  }
  return source;
}

export async function generateTelemetryV650Release(outputPath = defaultOutputPath) {
  const source = await readFile(sourcePath, 'utf8');
  const generated = transformTelemetryV650Release(source);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  return outputPath;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const output = process.env.DALLMAYR_V650_OUTPUT ? path.resolve(process.env.DALLMAYR_V650_OUTPUT) : defaultOutputPath;
  await generateTelemetryV650Release(output);
  console.log(`Generated ${path.relative(root, output)} with correlated MDB vend evidence including reset-after-approval.`);
}
