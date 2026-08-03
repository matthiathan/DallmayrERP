import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = process.env.PORT || '3000';
const nextCli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const child = spawn(process.execPath, [nextCli, 'start', '-p', port], {
  env: process.env,
  stdio: 'inherit',
});

function stopChild() {
  if (!child.killed) child.kill('SIGTERM');
}

process.on('SIGINT', stopChild);
process.on('SIGTERM', stopChild);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
