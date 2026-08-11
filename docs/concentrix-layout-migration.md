# Concentrix-derived DallmayrERP layout migration

Reference: `matthiathan/Concentrix`

The migration uses the Concentrix information architecture and spacing model while retaining DallmayrERP business functionality and the Dallmayr cream/gold/charcoal visual identity.

## Phase 1 — Shell

**Status: complete and approved**

- 264px Concentrix-style desktop rail
- 88px sticky header proportions
- 1600px content canvas
- compact navigation rhythm and Dallmayr-gold active state
- existing responsive phone/tablet contract remains final authority

## Phase 2 — Dashboard

**Status: complete and approved**

- Concentrix-style operational hero/status panel
- six compact KPI tiles on wide screens, reflowing on narrower desktops
- Dallmayr cream/white/gold palette
- existing Supabase counts remain unchanged
- existing Executive Reporting component remains functional, with Concentrix-derived panel spacing and geometry

## Phase 3 — Operational page family

**Status: complete and approved**

- dedicated desktop layer for list, record/detail, operational and form templates
- raised page headers and aligned page actions
- standardised command/filter bars and enterprise table density
- consistent record/detail and form section geometry
- operational split-view containment without removing actions or data
- medium-desktop wrapping without hiding Search or primary controls
- responsive phone/tablet authority remains later in the cascade

## Phase 4 — Specialist workspaces

**Status: complete and approved**

- administration and user-access workspaces
- personal appearance/settings presentation inside the existing account menu
- internal messaging presentation while preserving its two-pane and realtime behaviour
- global search overlay and result hierarchy
- telemetry and reporting cards/charts
- compatible specialist utility surfaces
- presentation/layout only; existing business logic and responsive authority preserved

## Phase 5 — Access Entry & First-Login

**Status: implementation checkpoint; validate before approval**

This phase applies the Concentrix secure-entry composition to the remaining access-boundary surfaces while retaining the richer DallmayrERP authentication and onboarding behaviour:

- desktop login and activation presentation
- Remember Me presentation without changing persistence semantics
- secure loading/access-pending/role-assignment status surfaces
- first-login profile completion and assigned-access presentation
- Dallmayr charcoal/cream/gold treatment derived from the Concentrix contained authentication hierarchy

Implementation rules:

- presentation/layout only
- preserve Supabase sign-in and activation calls
- preserve Remember Me preference and remembered-email behaviour
- preserve login/activation modes, validation and error states
- preserve role/default-path redirects and onboarding redirects
- preserve access-invite and user-details guard logic
- preserve onboarding validation, `user_details` updates and `refreshProfile` flow
- do not introduce a coarse-pointer responsive authority
- the 901–1366 coarse-pointer phone/touch-tablet contract remains unchanged and authoritative
- load the Phase 5 desktop layer after Phase 4 and before responsive authority

## Approval boundary

Each phase must be fully implemented and validated before the next phase starts. Phase 5 must stop at its approval checkpoint after CI passes; no later migration phase should begin without explicit user approval.
