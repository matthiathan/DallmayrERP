# Concentrix-derived DallmayrERP layout migration

Reference: `matthiathan/Concentrix`

The migration uses the Concentrix information architecture and spacing model while retaining DallmayrERP business functionality and the Dallmayr cream/gold/charcoal visual identity.

## Phase 1 — Shell

- 264px Concentrix-style desktop rail
- 88px sticky header proportions
- 1600px content canvas
- compact navigation rhythm and Dallmayr-gold active state
- existing responsive phone/tablet contract remains final authority

## Phase 2 — Dashboard

- Concentrix-style operational hero/status panel
- six compact KPI tiles on wide screens, reflowing to 3 and 2 columns on narrower desktops
- Dallmayr cream/white/gold palette
- existing Supabase counts remain unchanged
- existing Executive Reporting component remains functional, with Concentrix-derived panel spacing and geometry

## Approval boundary

Phases 1 and 2 are reviewable together on the migration branch. Later phases should not be implemented until explicitly approved.
