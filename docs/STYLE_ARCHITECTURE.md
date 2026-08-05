# DallmayrERP stylesheet architecture

The application has one global CSS entry point: `app/styles/index.css`.

Its five ordered imports are contractual:

1. `tokens.css` — colour, spacing and typography variables.
2. `legacy-feature-manifest.css` — quarantined route-specific legacy selectors.
3. `foundations.css` — shared element and primitive foundations.
4. `legacy-layout-manifest.css` — quarantined superseded layout programmes.
5. `application.css` — the current shell, navigation and page-family visual authority.

## Rules

- Do not import global CSS directly from `app/layout.tsx`.
- Do not add new files to either legacy manifest.
- New global visual work belongs in `application.css` or a focused stylesheet imported by it.
- A legacy import may be removed only after its used selectors have been migrated and representative routes have been reviewed.
- The style architecture check recursively validates imports, duplicate registration, missing files, cycles and prohibited `*-final.css` compatibility layers.

## Migration sequence

For each legacy stylesheet:

1. locate the components and routes using its selectors;
2. move reusable rules into the canonical design system or a component-scoped stylesheet;
3. verify desktop, tablet and mobile behavior;
4. remove the import from its quarantine manifest;
5. delete the file only when repository search confirms it is no longer referenced.
