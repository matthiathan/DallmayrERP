import { readFile } from 'node:fs/promises';
import process from 'node:process';

const [nextConfig, envExample] = await Promise.all([
  readFile('next.config.ts', 'utf8'),
  readFile('.env.example', 'utf8'),
]);

function fail(message) {
  console.error(`Feature flag check failed: ${message}`);
  process.exitCode = 1;
}

if (!nextConfig.includes("process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED === 'true'")) {
  fail('internal messaging must use an exact true opt-in check in next.config.ts.');
}

if (!nextConfig.includes("NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED: internalMessagingEnabled ? 'true' : 'false'")) {
  fail('next.config.ts must normalize the public messaging flag to explicit true/false values.');
}

if (!/^NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED=false$/m.test(envExample)) {
  fail('.env.example must keep internal messaging disabled by default.');
}

if (/^NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED=true$/m.test(envExample)) {
  fail('.env.example must not opt deployments into unfinished internal messaging.');
}

if (!process.exitCode) console.log('Feature flag contracts passed.');
