import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const applicationPath = path.join(root, 'app', 'styles', 'application.css');
const finishPath = path.join(root, 'app', 'professional-finish.css');

function fail(message) {
  console.error(`Professional UI finish check failed: ${message}`);
  process.exitCode = 1;
}

const [application, finish] = await Promise.all([
  readFile(applicationPath, 'utf8'),
  readFile(finishPath, 'utf8'),
]);

const finishImport = "@import '../professional-finish.css';";
const responsiveImport = "@import '../responsive-mobile-tablet.css';";
const finishIndex = application.indexOf(finishImport);
const responsiveIndex = application.indexOf(responsiveImport);
if (finishIndex < 0) fail('application.css must register professional-finish.css.');
if (responsiveIndex < 0) fail('application.css must retain responsive-mobile-tablet.css.');
if (finishIndex >= 0 && responsiveIndex >= 0 && finishIndex > responsiveIndex) {
  fail('professional-finish.css must load before the locked responsive-mobile-tablet authority.');
}

for (const requiredRule of [
  '--finish-space-1:',
  '--finish-control:',
  '.erp-state-banner',
  '.empty-state',
  '.customer360-hero',
  '.customer360-tabs',
  '.stock-mode-button',
  '.exception-case-card',
  '.dispatch-pressure-card',
  '.monday-my-work',
  '.admin-access-stage',
  '.field-service-workspace',
  '.spatial-dashboard',
  '@media (prefers-reduced-motion: reduce)',
  '@media (max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse)',
]) {
  if (!finish.includes(requiredRule)) fail(`professional-finish.css is missing ${requiredRule}.`);
}

for (const forbidden of [
  'background: #000',
  'background: black',
  '--ui-safe-blue',
]) {
  if (finish.includes(forbidden)) fail(`professional-finish.css contains forbidden legacy visual token ${forbidden}.`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Professional UI finish check passed: final hierarchy, legacy-workspace convergence, interaction/state polish and responsive pre-polish are registered.');
