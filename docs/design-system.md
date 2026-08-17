# DallmayrERP design system

## Global stylesheet contract

`app/layout.tsx` imports exactly one global stylesheet:

```ts
import './styles/index.css';
```

`app/styles/index.css` is the only top-level registry for application-wide CSS. Its order is deliberate:

1. `tokens.css` — stable spacing, typography, sizing, radius, elevation and z-index variables.
2. `legacy-feature-manifest.css` — transitional cascade registry while remaining broad legacy selectors are decomposed.
3. `foundations.css` — reusable layout and component primitives.
4. `legacy-layout-manifest.css` — remaining active layout/safety boundaries only.
5. `application.css` — current shell, route-family and responsive visual authority.

Do not add another CSS import to `app/layout.tsx`.

## CSS ownership

New and migrated styles must have an explicit owner:

- `app/styles/features/` for reusable feature presentation and shared interaction surfaces.
- `app/styles/page-families/` for workflow/route-family presentation.
- `app/styles/themes/` for required theme compatibility.
- component- or route-scoped stylesheets when the selectors have a single clear owner.

Do not create new root-level `app/*.css` feature files. The remaining `app/globals.css` is transitional and should be decomposed separately because it mixes old global element, shell and component selectors.

## Tokens

New global and feature styles should use the `--ds-*` variables from `app/styles/tokens.css`.

Primary groups:

- spacing: `--ds-space-1` through `--ds-space-12`
- radii: `--ds-radius-sm` through `--ds-radius-xl`
- controls: `--ds-control-sm`, `--ds-control-md`, `--ds-control-lg`, `--ds-touch-target`
- typography: `--ds-font-*` and `--ds-line-*`
- layout: `--ds-page-max`, `--ds-content-max`, `--ds-readable-max`, `--ds-form-max`
- layering: `--ds-z-*`
- motion: `--ds-duration-*` and `--ds-ease-standard`
- semantic theme aliases: `--ds-surface`, `--ds-text`, `--ds-border`, `--ds-accent`, `--ds-focus`

Slate Modern and Warm Sand continue to provide underlying appearance values through the active appearance system.

## CSS primitives

`app/styles/foundations.css` provides shared primitives such as:

- `.ds-stack`
- `.ds-cluster`
- `.ds-grid`
- `.ds-surface`
- `.ds-page-header`
- `.ds-section-header`
- `.ds-command-bar`
- `.ds-filter-bar`
- `.ds-action-bar`
- `.ds-scroll-region`
- `.ds-readable`
- `.ds-form-layout`
- `.ds-form-grid`
- `.ds-visually-hidden`

Prefer these classes over introducing another page-specific spacing or surface system.

## React primitives

`components/ui/WorkspacePrimitives.tsx` provides:

- `WorkspaceSurface`
- `WorkspaceSectionHeader`
- `WorkspaceCommandBar`

The shared `PageToolbar` uses these primitives. New workspace components should use them before creating bespoke surface or section-header markup.

## Compatibility policy

Do not create new files named `*-final.css` and do not add another blanket override layer. When a compatibility rule is needed:

1. Prefer fixing the owning component or canonical feature/page-family stylesheet.
2. Use a shared primitive or token where possible.
3. Keep unavoidable compatibility selectors beside the feature that owns them.
4. Document why broad compatibility is still necessary before adding it to a global authority layer.

## Automated enforcement

Run:

```bash
npm run stylecheck
```

The checks verify that:

- `app/layout.tsx` has exactly one CSS import and it is `./styles/index.css`.
- the registered stylesheet graph resolves without cycles or duplicate imports.
- current desktop and responsive authority order is intact.
- migrated live feature CSS remains under canonical ownership folders.
- retired root-level feature paths cannot be reintroduced silently.

CI runs these checks before TypeScript validation and the production build.
