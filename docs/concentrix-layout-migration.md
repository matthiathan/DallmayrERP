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

**Status: implementation checkpoint; validate before approval**

The original continuation handoff did not prescribe a detailed Phase 4 family. The scope is therefore the remaining specialist desktop surfaces that can be migrated without changing business logic:

- administration and user-access workspaces
- personal appearance/settings presentation inside the existing account menu
- internal messaging presentation while preserving its two-pane and realtime behaviour
- global search overlay and result hierarchy
- telemetry and reporting cards/charts
- compatible specialist utility surfaces

Implementation rules:

- presentation/layout only
- preserve routes, Supabase queries and mutations, authentication and permissions
- preserve messaging subscriptions, conversation creation and send logic
- preserve account-menu anchoring, upward desktop pop-out behaviour, sign out and password/settings actions
- preserve search queries and navigation targets
- do not create another responsive system
- load the Phase 4 desktop layer after Phase 3 and before responsive authority

## Approval boundary

Each phase must be fully implemented and validated before the next phase starts. Phase 4 must stop at its approval checkpoint after CI passes; no later migration phase should begin without explicit user approval.
