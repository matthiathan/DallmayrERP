# DallmayrERP stylesheet architecture

The application has one global CSS entry point: `app/styles/index.css`.

Its five ordered imports are contractual:

1. `tokens.css` — colour, spacing and typography variables.
2. `legacy-feature-manifest.css` — transitional registry for live feature styles that are now classified by owner.
3. `foundations.css` — shared element and primitive foundations.
4. `legacy-layout-manifest.css` — quarantined active compatibility/layout boundaries.
5. `application.css` — the canonical application authority registry.

## Feature ownership

Live feature CSS must not accumulate as unclassified files in `app/`.

`legacy-feature-manifest.css` preserves the established cascade while classifying its styles under:

- `app/styles/features/` — reusable feature/component presentation;
- `app/styles/page-families/` — route-family and operational workspace presentation;
- `app/styles/themes/` — theme-specific compatibility.

The manifest order remains contractual. Moving a stylesheet does not grant permission to change its selectors, specificity or position in the cascade.

## Application authority

`app/styles/application.css` contains exactly three ordered manifests:

1. `application/base.css` — base composition, shared component utilities and runtime compatibility;
2. `application/desktop.css` — desktop reference, professional UI, Concentrix-derived desktop surfaces and shell utilities;
3. `application/responsive.css` — responsive runtime/interactions, finish layers, compact-desktop authority and the final phone/touch-tablet contract.

The flattened leaf sequence is validated in CI. `app/responsive-mobile-tablet.css` must remain the final application leaf.

These manifests are ownership registries, not override buckets. Add or change visual rules in the stylesheet that owns the component or page family rather than adding another `fix`, `final` or `phase` layer to `application.css`.

## Rules

- Do not import global CSS directly from `app/layout.tsx`; it imports only `./styles/index.css`.
- Do not add new unclassified/root-level feature styles to `legacy-feature-manifest.css`.
- Do not add a fourth application authority without an explicit architecture decision and corresponding contract change.
- Do not change application leaf order casually; desktop and responsive precedence is intentional.
- Do not create new `*-final.css` compatibility files.
- Prefer the canonical `ErpLayout`/design-system primitives and their owning styles before introducing page-specific surface rules.
- A transitional import may be removed only after its used selectors have been migrated and representative routes have been validated.

## Automated enforcement

`npm run stylecheck` runs two guards:

- `check-style-architecture.mjs` validates the single entry point, import graph, cycles, explicit base/desktop/responsive application authorities, exact flattened application leaf order, final responsive ownership and established visual safety contracts.
- `check-style-feature-ownership.mjs` validates classified feature paths, exact transitional manifest order and prevents the retired `app/*.css` feature copies from returning.

The optional `npm run prestylecheck` guard also validates retired shell/navigation registrations against the same ownership model.

## Migration sequence

For remaining compatibility CSS:

1. identify the component/page-family owner and every consumer;
2. move or merge rules into that canonical owner without changing behavior;
3. verify desktop, compact desktop, tablet and phone behavior;
4. remove the transitional registration only when no consumer depends on it;
5. delete obsolete selectors/files only after repository and browser validation confirms they are unused.

This structure reduces cascade ambiguity without pretending the historical selector debt is already gone. Specificity and `!important` cleanup should happen incrementally inside the owning stylesheets with regression coverage.
