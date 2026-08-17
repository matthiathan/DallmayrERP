# DallmayrERP design system

## Global stylesheet contract

`app/layout.tsx` imports exactly one global stylesheet:

```ts
import './styles/index.css';
```

`app/styles/index.css` is the only application-wide CSS entry point. Its five ordered authorities are:

1. `tokens.css` — stable spacing, typography, sizing, radius, elevation and z-index variables.
2. `legacy-feature-manifest.css` — transitional registry for classified live feature/page-family/theme styles.
3. `foundations.css` — reusable layout and component foundations.
4. `legacy-layout-manifest.css` — quarantined active compatibility/layout boundaries.
5. `application.css` — canonical base, desktop and responsive application authorities.

Do not add another CSS import to `app/layout.tsx`. New global work belongs to the stylesheet that owns the component or page family, not to another late override file.

## Application cascade

`application.css` is intentionally small. It imports only:

- `application/base.css`
- `application/desktop.css`
- `application/responsive.css`

CI validates the exact flattened leaf order. `responsive-mobile-tablet.css` remains the final application leaf, preserving phone/touch-tablet authority after compact-desktop and finishing rules.

Live feature styles are classified under `app/styles/features/`, `app/styles/page-families/` and `app/styles/themes/`. The transitional feature manifest preserves their historical order while migration continues.

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

Slate Modern and Warm Sand continue to provide underlying colour values through the existing appearance variables.

## CSS primitives

`app/styles/foundations.css` provides shared structural hooks including:

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

Prefer these shared hooks over introducing another page-specific spacing or surface system.

## React primitives

`components/ui/ErpLayout.tsx` is the high-level layout/surface authority. It provides the canonical page, panel, command, metric, record and state structures, including:

- `ErpPage` / `ErpPageHeader`
- `ErpSurface` / `ErpSectionHeader`
- `ErpCommandBar` / `ErpToolbar` / `ErpFilterBar`
- `ErpPanel` / `ErpContentGrid`
- `ErpMetricGrid` / `ErpMetricCard`
- `ErpTableShell` / `ErpPagination`
- `ErpRecordLayout` / `ErpRecordSummary`
- `ErpStateBanner`

`components/ui/DesignSystem.tsx` remains the low-level control layer for buttons, fields, inputs, badges, cards and basic states.

`WorkspacePrimitives.tsx` exists only as compatibility aliases. New code should import the high-level primitives directly from `ErpLayout`.

## Compatibility policy

Do not create new files named `*-final.css` or add new ad-hoc `fix`/`phase` imports to `application.css`.

When a late compatibility rule is necessary:

1. fix the owning component or owner stylesheet where possible;
2. use the shared design-system primitive or token when the behavior is reusable;
3. place unavoidable compatibility in the narrowest existing owner;
4. preserve responsive authority and add regression coverage for the affected route.

Historical files with `phase`, `fix`, `finish` or similar names still exist because their rules remain live. #12 classifies and orders that debt; it does not claim those selectors or `!important` declarations have all been eliminated.

## Automated enforcement

Run:

```bash
npm run stylecheck
```

The check verifies that:

- `app/layout.tsx` has exactly one CSS import and it is `./styles/index.css`;
- the CSS import graph resolves without cycles or duplicate registrations;
- application CSS has exactly the base, desktop and responsive authority manifests;
- the flattened application leaf order is unchanged and the mobile/tablet authority remains final;
- live feature CSS is stored under explicit ownership folders rather than restored to `app/*.css`;
- no new `*-final.css` compatibility layer is registered;
- established shell, readability, responsive and accessibility safety contracts remain present.

CI runs this check before TypeScript validation and the production build.
