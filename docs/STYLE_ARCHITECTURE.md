# DallmayrERP stylesheet architecture

The application has one global CSS entry point: `app/styles/index.css`.

Its five ordered imports are contractual:

1. `tokens.css` — colour, spacing and typography variables.
2. `legacy-feature-manifest.css` — transitional registry preserving the approved historical cascade while live feature rules are rehomed under canonical ownership folders.
3. `foundations.css` — shared element and primitive foundations.
4. `legacy-layout-manifest.css` — a small quarantine for the remaining active layout boundaries.
5. `application.css` — the current shell, navigation and page-family visual authority.

## Canonical ownership

Live feature CSS no longer belongs at the `app/` root. Use these ownership folders:

- `app/styles/features/` — reusable feature and interaction presentation such as appearance, tables, account controls and shared widgets.
- `app/styles/page-families/` — route/workflow families such as warehouse stock, operations, service, dispatch and customer 360.
- `app/styles/themes/` — appearance/theme-specific compatibility that is still required by live UI.
- component/route-scoped stylesheets — when a style is genuinely owned by one component or route.

`app/globals.css` is the only remaining broad legacy feature stylesheet intentionally left at the app root. It contains old global/shell selectors whose safe decomposition needs selector-by-selector validation rather than a path-only move.

The transitional feature manifest preserves the exact previous import order. Moving a file does not authorize changing its selectors, specificity or cascade position in the same change.

## Rules

- Do not import global CSS directly from `app/layout.tsx`.
- Do not add new unclassified/root-level feature CSS.
- New visual work belongs in an owning canonical stylesheet, a component-scoped stylesheet, or a focused stylesheet imported by `application.css`.
- Do not add new presentation programmes to either legacy manifest.
- A legacy import may be removed only after its used selectors have been migrated and representative routes have been reviewed.
- Delete a retired path only when its bytes have been moved or repository search confirms its selectors are no longer required.
- Preserve cascade order during path-only migrations; visual redesign and architecture migration should be separate changes.

## Migration sequence

For each remaining legacy stylesheet or selector group:

1. locate the components and routes using its selectors;
2. classify the owner as feature, page family, theme or component;
3. move live rules into that canonical owner without changing behavior;
4. verify desktop, tablet and mobile behavior;
5. remove the obsolete import/path;
6. delete dead rules only when usage is disproven rather than assumed.

## Automated enforcement

`npm run stylecheck` runs both the architecture check and the feature-ownership check. Together they validate import resolution/order, prevent retired app-root feature files from returning, and ensure the classified canonical feature files remain present.
