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

function requireContracts(name, contents, contracts) {
  for (const contract of contracts) {
    if (!contents.includes(contract)) fail(`${name} is missing accessibility contract: ${contract}`);
  }
}

const appShell = await source('components/layout/AppShell.tsx');
requireContracts('AppShell', appShell, [
  'className="skip-link" href="#main-content"',
  'id="main-content" tabIndex={-1}',
  'aria-controls="mobile-navigation"',
  'aria-expanded={menuOpen}',
]);

const globalSearch = await source('components/ui/GlobalSearch.tsx');
requireContracts('GlobalSearch', globalSearch, [
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
]);

const mobileNavigation = await source('components/layout/MobileNavigation.tsx');
requireContracts('Mobile navigation', mobileNavigation, [
  'aria-modal="true"',
  'role="dialog"',
  'id="mobile-navigation"',
  'closeButtonRef.current?.focus()',
  "if (event.key === 'Escape')",
  "if (event.key !== 'Tab' || !panelRef.current) return",
  'restoreTarget?.focus()',
  'aria-controls="mobile-navigation" aria-expanded={menuOpen}',
  'aria-label="Open global search"',
  'href="/alerts"',
]);

const notifications = await source('components/features/MobileAppExperience.tsx');
requireContracts('Notification Inbox', notifications, [
  'aria-modal="true"',
  'role="dialog"',
  'restoreFocusRef.current',
  'closeRef.current?.focus()',
  "if (event.key === 'Escape')",
  "if (event.key !== 'Tab' || !panelRef.current) return",
  'aria-expanded={open}',
]);

const fieldOffline = await source('components/features/FieldServiceOfflineManager.tsx');
requireContracts('Offline field-work queue', fieldOffline, [
  "const FIELD_OFFLINE_DIALOG_ID = 'field-offline-queue-dialog'",
  "window.addEventListener('dallmayr-open-field-queue', openQueue)",
  'const restoreFocusRef = useRef<HTMLElement | null>(null)',
  'aria-controls={FIELD_OFFLINE_DIALOG_ID}',
  'aria-haspopup="dialog"',
  'aria-modal="true"',
  'id={FIELD_OFFLINE_DIALOG_ID}',
  'restoreTarget?.focus()',
  'aria-live="polite"',
]);

const accountMenu = await source('components/layout/GlobalAccountMenu.tsx');
requireContracts('Account menu', accountMenu, [
  'const detailsRef = useRef<HTMLDetailsElement | null>(null)',
  'const settingsToggleRef = useRef<HTMLButtonElement | null>(null)',
  "if (event.key !== 'Escape') return",
  'settingsToggleRef.current?.focus()',
  'summaryRef.current?.focus()',
  'aria-controls={PERSONAL_SETTINGS_ID}',
  'aria-live="polite"',
  'role="status"',
]);

const customerSelect = await source('components/ui/CustomerSelect.tsx');
requireContracts('Customer combobox', customerSelect, [
  'role="combobox"',
  'aria-autocomplete="list"',
  'aria-activedescendant=',
  'aria-controls={listboxId}',
  'aria-expanded={open}',
  'aria-haspopup="listbox"',
  'role="listbox"',
  'role="option"',
  'tabIndex={-1}',
  'aria-describedby={showSelectionNote ? selectionNoteId : undefined}',
]);

const mobileDataViews = await source('components/ui/MobileDataViews.tsx');
requireContracts('Mobile filter sheet', mobileDataViews, [
  'aria-modal="true"',
  'role="dialog"',
  'restoreFocusRef.current',
  'closeButtonRef.current?.focus()',
  "if (event.key === 'Escape')",
  "if (event.key !== 'Tab' || !panelRef.current) return",
]);

const customerItemCard = await source('components/boards/CustomerItemCard.tsx');
requireContracts('Customer item card', customerItemCard, [
  'aria-modal="true"',
  'role="dialog"',
  'previousFocusRef.current',
  'previousFocusRef.current?.focus()',
  "if (event.key !== 'Tab' || !panelRef.current) return",
  'role="tablist"',
  'aria-controls={panelIdForTab(tab.id)}',
  'aria-selected={activeTab === tab.id}',
  'id={tabIdForTab(tab.id)}',
  'role="tab"',
  'tabIndex={activeTab === tab.id ? 0 : -1}',
  "event.key === 'ArrowRight' || event.key === 'ArrowDown'",
  "event.key === 'ArrowLeft' || event.key === 'ArrowUp'",
  "event.key === 'Home'",
  "event.key === 'End'",
  "aria-labelledby={tabIdForTab('overview')}",
  "id={panelIdForTab('overview')}",
  'role="tabpanel"',
]);

const enterpriseTable = await source('components/ui/EnterpriseDataTable.tsx');
requireContracts('Enterprise data table', enterpriseTable, [
  'aria-sort=',
  'aria-label={`Filter ${column.header} column`}',
  'aria-label={`Resize ${column.header} column.',
  "event.key === 'ArrowLeft'",
  "event.key === 'ArrowRight'",
]);

const login = await source('app/login/page.tsx');
requireContracts('Login', login, [
  'className="error" role="alert"',
  'aria-live="polite" className="success" role="status"',
  'autoComplete="email"',
  "autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}",
]);

const applicationFailureScreen = await source('components/system/ApplicationFailureScreen.tsx');
requireContracts('Application failure screen', applicationFailureScreen, [
  "'use client';",
  'aria-labelledby="application-failure-title"',
  "aria-live={announceAsAlert ? 'assertive' : 'polite'}",
  "role={announceAsAlert ? 'alert' : 'status'}",
  'onClick={handleRetry}',
  'Retry',
  'href="/"',
  'Return to Dashboard',
  'Support reference',
  'provide this reference to ERP support',
]);

const routeError = await source('app/error.tsx');
requireContracts('Route error boundary', routeError, [
  "'use client';",
  'error: Error & { digest?: string }',
  'error.digest',
  'ERP-ROUTE-UNEXPECTED',
  'onRetry={reset}',
  'announceAsAlert',
]);

const globalError = await source('app/global-error.tsx');
requireContracts('Global error boundary', globalError, [
  "'use client';",
  'error: Error & { digest?: string }',
  'error.digest',
  'ERP-GLOBAL-UNEXPECTED',
  '<html lang="en">',
  '<body',
  'onRetry={reset}',
  'announceAsAlert',
]);

const notFound = await source('app/not-found.tsx');
requireContracts('Not found boundary', notFound, [
  'ApplicationFailureScreen',
  'Page not found',
  'ERP-404-NOT-FOUND',
  'tone="warning"',
]);

const responsive = await source('app/responsive-mobile-tablet.css');
const responsiveWithoutComments = responsive.replace(/\/\*[\s\S]*?\*\//g, '').trim();
if (!responsiveWithoutComments.startsWith('@media (max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse) {')) {
  fail('Responsive authority must retain the locked phone/touch-tablet media query.');
}
requireContracts('Responsive authority', responsive, [
  'overflow-x: clip !important',
  'touch-action: pan-y pinch-zoom',
  'width: 48px !important',
  'min-width: 48px !important',
  'height: 48px !important',
  'min-height: 48px !important',
  'font-size: 16px !important',
  'env(safe-area-inset-top)',
  'env(safe-area-inset-bottom)',
]);

const readability = await source('app/styles/canonical-readability-safety.css');
requireContracts('Canonical readability safety', readability, [
  ':focus-visible',
  'outline: 3px solid',
  'touch-action: manipulation',
  'overflow-wrap: anywhere',
]);

if (process.exitCode) process.exit(process.exitCode);
console.log('Responsive/accessibility check passed: keyboard focus, dialog semantics, application failure recovery, live status, combobox/table/tab semantics, touch targets and responsive overflow contracts are present.');
