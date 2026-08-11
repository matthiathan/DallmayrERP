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

**Status: complete and approved**

- desktop login and activation presentation
- Remember Me presentation without changing persistence semantics
- secure loading/access-pending/role-assignment status surfaces
- first-login profile completion and assigned-access presentation
- Dallmayr charcoal/cream/gold treatment derived from the Concentrix contained authentication hierarchy
- Supabase sign-in, activation, access guards, redirects and onboarding persistence remain unchanged
- the existing phone/touch-tablet responsive contract remains authoritative

## Phase 6 — Execution & Detail Interaction Surfaces

**Status: complete, CI validated and approved**

- assigned field-service queue and guided job-closure presentation
- work execution cards for SOP/time, parts usage, completion details, evidence and sign-off
- stock and machine barcode/QR capture and matched-record feedback
- status timelines and guided stepper hierarchy
- asset ticket and machine-match detail presentation
- shared dense enterprise table search, filter, resize, scroll and pagination presentation
- customer lookup result presentation used by machine/detail capture forms
- no feature component or business-logic file changed in Phase 6
- existing mobile/offline/scanner behaviour remains unchanged

Validation: GitHub Actions run #558 passed on final Phase 6 head `45ddcdcf26d59458193e351dc1e9693c600d2488`.

## Phase 7 — Final Visual Audit & Compatibility Polish

**Status: implementation checkpoint; validate before final approval**

This is the final migration phase. It audits the remaining quarantined legacy layout programmes and explicitly normalises the bespoke surfaces that sit outside the earlier page-family layers:

- Role Today workspaces and attention/priority cards
- Monday-style board headers, command bars, data surfaces and pagination
- focused Monday item-card/detail drawers
- My Work personal queue, board and calendar surfaces
- service kanban/calendar/map presentation
- legacy Dynamics/workbench/Monday visual token compatibility
- remaining generic workbench cards that still use quarantined selectors

Implementation rules:

- presentation/layout only
- retain the legacy manifests because their selectors are still used by mounted components
- do not remove routes, controls, actions or data
- do not change Supabase queries, mutations, RPCs, authentication, permissions, scanner logic, messaging, workflows or business rules
- remap legacy blue/teal programme accents to Dallmayr gold only where they are visual-brand accents; semantic success/warning/danger colours remain semantic
- do not create a coarse-pointer responsive authority
- do not hide functionality in the final audit layer
- existing responsive phone/touch-tablet layers remain later in the cascade and authoritative
- load the final audit layer after Phase 6 and before responsive authority

## Final approval boundary

Phase 7 is the final planned migration phase. After the final Phase 7 branch head passes stylesheet architecture, mobile interaction contracts, TypeScript, production build, security pentest and Chromium browser tests, stop for final user approval. Do not merge PR #92 until that explicit final approval is given.
