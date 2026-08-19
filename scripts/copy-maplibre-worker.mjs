import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const distributionDirectory = path.join(path.dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const publicDirectory = path.join(process.cwd(), 'public', 'maplibre');

mkdirSync(publicDirectory, { recursive: true });

for (const fileName of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(path.join(distributionDirectory, fileName), path.join(publicDirectory, fileName));
}

console.log('MapLibre worker assets prepared.');
