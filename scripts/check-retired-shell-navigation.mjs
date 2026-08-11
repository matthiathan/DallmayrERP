import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifestPath = path.join(root, 'app', 'styles', 'legacy-feature-manifest.css');
const manifest = await readFile(manifestPath, 'utf8');

const retiredImports = [
  "@import '../erp-classic-navigation.css'",
  "@import '../notch-nav-fixes.css'",
  "@import '../ribbon-background.css'",
  "@import '../dark-bezel-navigation.css'",
  "@import '../fixed-top-navigation.css'",
  "@import '../desktop-nav-overflow.css'",
  "@import '../user-first-application-shell.css'",
];

for (const retiredImport of retiredImports) {
  if (manifest.includes(retiredImport)) {
    console.error(`Retired shell/navigation programme must not be re-registered: ${retiredImport}`);
    process.exitCode = 1;
  }
}

const appShell = await readFile(path.join(root, 'components', 'layout', 'AppShell.tsx'), 'utf8');
for (const obsoleteHook of [
  'erp-chrome',
  'notch-navbar-frame',
  'notch-menu-row',
  'erp-menu-overflow',
  'ribbon-app-background',
]) {
  if (appShell.includes(obsoleteHook)) {
    console.error(`Current AppShell must not regress to retired shell hook: ${obsoleteHook}`);
    process.exitCode = 1;
  }
}

const navigation = await readFile(path.join(root, 'app', 'navigation.css'), 'utf8');
for (const requiredRule of ['.skip-link', '.skip-link:focus']) {
  if (!navigation.includes(requiredRule)) {
    console.error(`Active navigation foundation is missing accessibility rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const foundations = await readFile(path.join(root, 'app', 'styles', 'foundations.css'), 'utf8');
for (const requiredRule of [
  ':focus-visible',
  '@media (prefers-reduced-motion: reduce)',
  '@media print',
  '.application-header',
  '.dallmayr-sidebar',
]) {
  if (!foundations.includes(requiredRule)) {
    console.error(`Shared foundations are missing retired-shell replacement rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const responsive = await readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8');
for (const requiredRule of [
  '.application-header',
  '.mobile-nav-portal-root',
  '.mobile-quick-bar',
  '.application-mobile-menu-button',
]) {
  if (!responsive.includes(requiredRule)) {
    console.error(`Responsive authority is missing retired-shell replacement rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Retired shell/navigation guard passed: legacy notch/bezel/fixed-top programmes remain unregistered and current shell/accessibility/mobile owners are present.');
