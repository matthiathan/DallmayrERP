import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function fail(message) {
  console.error(`Responsive/accessibility check failed: ${message}`);
  process.exitCode = 1;
}

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

const appShell = await source('components/layout/AppShell.tsx');
for (const contract of [
  'className="skip-link" href="#main-content"',
  'id="main-content" tabIndex={-1}',
  'aria-controls="mobile-navigation"',
  'aria-expanded={menuOpen}',
]) {
  if (!appShell.includes(contract)) fail(`AppShell is missing keyboard/navigation contract: ${contract}`);
}

const globalSearch = await source('components/ui/GlobalSearch.tsx');
for (const contract of [
  "const GLOBAL_SEARCH_DIALOG_ID = 'global-search-dialog'",
  'const dialogRef = useRef<HTMLElement | null>(null)',
  'const restoreFocusRef = useRef<HTMLElement | null>(null)',
  "if (event.key === 'Escape')",
  "if (event.key !== 'Tab' || !dialogRef.current) return",
  'aria-controls={GLOBAL_SEARCH_DIALOG_ID}',
  'aria-expanded={open}',
  'aria-modal="true"',
  'ref={dialogRef}',
  'restoreTarget?.focus()',
]) {
  if (!globalSearch.includes(contract)) fail(`GlobalSearch is missing modal keyboard contract: ${contract}`);
}

const mobileNavigation = await source('components/layout/MobileNavigation.tsx');
for (const contract of [
  'aria-modal="true"',
  'role="dialog"',
  'id="mobile-navigation"',
  'closeButtonRef.current?.focus()',
  "if (event.key === 'Escape')",
  "if (event.key !== 'Tab' || !panelRef.current) return",
  'restoreTarget?.focus()',
  'aria-controls="mobile-navigation" aria-expanded={menuOpen}',
]) {
  if (!mobileNavigation.includes(contract)) fail(`Mobile navigation is missing dialog/focus contract: ${contract}`);
}

const notifications = await source('components/features/MobileAppExperience.tsx');
for (const contract of [
  'aria-modal="true"',
  'role="dialog"',
  'restoreFocusRef.current',
  'closeRef.current?.focus()',
  "if (event.key === 'Escape')",
  "if (event.key !== 'Tab' || !panelRef.current) return",
  'aria-expanded={open}',
]) {
  if (!notifications.includes(contract)) fail(`Notification Inbox is missing dialog/focus contract: ${contract}`);
}

const accountMenu = await source('components/layout/GlobalAccountMenu.tsx');
for (const contract of [
  'const detailsRef = useRef<HTMLDetailsElement | null>(null)',
  'const settingsToggleRef = useRef<HTMLButtonElement | null>(null)',
  "if (event.key !== 'Escape') return",
  'settingsToggleRef.current?.focus()',
  'summaryRef.current?.focus()',
  'aria-controls={PERSONAL_SETTINGS_ID}',
  'aria-live="polite"',
  'role="status"',
]) {
  if (!accountMenu.includes(contract)) fail(`Account menu is missing keyboard/status contract: ${contract}`);
}

const customerItemCard = await source('components/boards/CustomerItemCard.tsx');
for (const contract of [
  'aria-modal="true"',
  'role="dialog"',
  'previousFocusRef.current',
  'previousFocusRef.current?.focus()',
  "if (event.key !== 'Tab' || !panelRef.current) return",
]) {
  if (!customerItemCard.includes(contract)) fail(`Customer item card is missing modal focus contract: ${contract}`);
}

const login = await source('app/login/page.tsx');
for (const contract of [
  'className="error" role="alert"',
  'aria-live="polite" className="success" role="status"',
  'autoComplete="email"',
  "autoComplete={isActivate ? 'new-password' : 'current-password'}",
]) {
  if (!login.includes(contract)) fail(`Login is missing accessible form/status contract: ${contract}`);
}

const responsive = await source('app/responsive-mobile-tablet.css');
const responsiveWithoutComments = responsive.replace(/\/\*[\s\S]*?\*\//g, '').trim();
if (!responsiveWithoutComments.startsWith('@media (max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse) {')) {
  fail('Responsive authority must retain the locked phone/touch-tablet media query.');
}
for (const contract of [
  'overflow-x: clip !important',
  'touch-action: pan-y pinch-zoom',
  'width: 48px !important',
  'min-width: 48px !important',
  'height: 48px !important',
  'min-height: 48px !important',
  'env(safe-area-inset-top)',
  'env(safe-area-inset-bottom)',
]) {
  if (!responsive.includes(contract)) fail(`Responsive authority is missing touch/overflow contract: ${contract}`);
}

const readability = await source('app/styles/canonical-readability-safety.css');
for (const contract of [
  ':focus-visible',
  'outline: 3px solid',
  'touch-action: manipulation',
  'overflow-wrap: anywhere',
]) {
  if (!readability.includes(contract)) fail(`Canonical readability safety is missing accessibility contract: ${contract}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Responsive/accessibility check passed: keyboard focus, dialog semantics, live status, touch targets and responsive overflow contracts are present.');
