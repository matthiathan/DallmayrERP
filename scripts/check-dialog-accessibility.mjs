import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function requireText(name, contents, expected, message) {
  if (!contents.includes(expected)) failures.push(`${name}: ${message}`);
}

function forbidText(name, contents, forbidden, message) {
  if (contents.includes(forbidden)) failures.push(`${name}: ${message}`);
}

const dialog = await source('components/ui/AccessibleDialog.tsx');
const quickAccess = await source('components/layout/EnterpriseProductivityHub.tsx');
const dialogStyles = await source('app/canonical-dialog.css');
const applicationStyles = await source('app/styles/application.css');

for (const [expected, message] of [
  ["import { createPortal } from 'react-dom';", 'must render outside the inert application background.'],
  ['const dialogRef = useRef<HTMLElement | null>(null);', 'must retain a dialog ref for focus containment.'],
  ['const restoreFocusRef = useRef<HTMLElement | null>(null);', 'must remember the pre-dialog focus target.'],
  ["if (event.key === 'Escape')", 'must close on Escape.'],
  ["if (event.key !== 'Tab' || !dialogRef.current) return;", 'must trap Tab navigation.'],
  ['element.inert = true;', 'must make background surfaces non-interactive.'],
  ["element.setAttribute('aria-hidden', 'true');", 'must hide inert background surfaces from assistive technology.'],
  ['element.inert = inert;', 'must restore prior background inert state.'],
  ["if (ariaHidden === null) element.removeAttribute('aria-hidden');", 'must restore prior aria-hidden state.'],
  ["document.body.style.overflow = 'hidden';", 'must lock background scrolling while open.'],
  ['aria-modal="true"', 'must expose modal semantics.'],
  ['role="dialog"', 'must expose dialog semantics.'],
  ['tabIndex={-1}', 'must provide a focusable dialog fallback.'],
  ['window.requestAnimationFrame(() => restoreTarget?.focus());', 'must restore focus after closing.'],
]) requireText('AccessibleDialog', dialog, expected, message);

for (const [expected, message] of [
  ["const QUICK_ACCESS_DIALOG_ID = 'quick-access-dialog';", 'must have a stable dialog id.'],
  ['aria-controls={QUICK_ACCESS_DIALOG_ID}', 'trigger must reference the dialog.'],
  ['aria-expanded={open}', 'trigger must expose open state.'],
  ['aria-haspopup="dialog"', 'trigger must expose dialog intent.'],
  ['<AccessibleDialog', 'must use the reusable dialog primitive.'],
  ['labelledBy={QUICK_ACCESS_DIALOG_TITLE_ID}', 'dialog must be labelled by its visible title.'],
  ['describedBy={QUICK_ACCESS_DIALOG_DESCRIPTION_ID}', 'dialog must be described by its visible summary.'],
  ['data-dialog-initial-focus', 'dialog must nominate a deterministic initial focus target.'],
  ['if (open) return;', 'global productivity shortcuts must not act behind the open modal.'],
]) requireText('Quick Access', quickAccess, expected, message);

forbidText(
  'Quick Access',
  quickAccess,
  "style={{ position: 'fixed'",
  'must not recreate its old inline fixed overlay.',
);
forbidText(
  'Quick Access',
  quickAccess,
  'aria-modal="true"\n          role="dialog"',
  'must delegate modal semantics to AccessibleDialog instead of duplicating them inline.',
);

for (const expected of [
  '.accessible-dialog-overlay',
  '.accessible-dialog-panel',
  '.quick-access-dialog',
  '@media (max-width: 760px)',
]) requireText('Canonical dialog styles', dialogStyles, expected, `missing ${expected}.`);

requireText(
  'Application stylesheet',
  applicationStyles,
  "@import '../canonical-dialog.css';",
  'must register the canonical dialog stylesheet.',
);

const dialogImport = applicationStyles.indexOf("@import '../canonical-dialog.css';");
const responsiveImport = applicationStyles.lastIndexOf("@import '../responsive-mobile-tablet.css';");
if (dialogImport === -1 || responsiveImport === -1 || dialogImport > responsiveImport) {
  failures.push('Application stylesheet: canonical dialog styles must load before the final responsive authority.');
}

if (failures.length) {
  console.error('Dialog accessibility contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Dialog accessibility contract passed: modal semantics, focus containment, background isolation, scroll lock and focus restoration are enforced.');
