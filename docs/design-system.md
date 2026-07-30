# DallmayrERP design system

## Global stylesheet contract

`app/layout.tsx` imports exactly one global stylesheet:

```ts
import './styles/index.css';
```

`app/styles/index.css` is the only registry for application-wide CSS. Its order is deliberate:

1. `tokens.css` — stable spacing, typography, sizing, radius, elevation and z-index variables.
2. Existing foundations and feature styles — retained in their established order while migration continues.
3. `foundations.css` — reusable layout and component primitives.
4. Current shell, page-template and Today-workspace systems.
5. `navigation-contract.css` and `compatibility-overrides.css` — explicit final contracts.

Do not add another CSS import to `app/layout.tsx`. Register new global styles in `app/styles/index.css` and place them in the correct group.

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

Slate Modern and Warm Sand continue to provide the underlying colour values through the existing appearance variables.

## CSS primitives

`app/styles/foundations.css` provides:

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

Do not create new files named `*-final.css`. When a feature needs a late compatibility rule:

1. Prefer fixing the owning component or feature stylesheet.
2. Use a shared primitive or token where possible.
3. Only use `app/styles/compatibility-overrides.css` when the rule genuinely spans legacy systems.
4. Record the selector and the reason in that file.

The previous adaptive-contrast, mobile-layout and navigation `*-final.css` files were migrated into named contracts.

## Automated enforcement

Run:

```bash
npm run stylecheck
```

The check verifies that:

- `app/layout.tsx` has one CSS import.
- the import is `./styles/index.css`.
- the stylesheet registry contains no duplicates.
- no `*-final.css` file is registered.
- required design-system files are present.
- every registered local stylesheet resolves to an existing file.

CI runs this check before TypeScript validation and the production build.
