# DallmayrERP RBAC and UI refinement

This implementation pass keeps the database unchanged and refines only the web application.

## Role source of truth

DallmayrERP uses Supabase Auth for sign-in and `public.users` for business authorization.

The app loads the signed-in Supabase Auth user, then looks up the matching business profile in `public.users` by:

1. `auth_user_id`
2. email address fallback

The role used by the UI is `public.users.role`. The app does not use user metadata for authorization.

## Current role routing

| Role | Default page | Access |
|---|---|---|
| `admin` | `/` | All pages |
| `operations` | `/operations` | Operations workspace |
| `sales` | `/sales` | Sales workspace |
| `finance` | `/finance` | Finance workspace |
| `marketing` | `/marketing` | Marketing pages |
| `executive` | `/executive` | Executive pages |
| `warehouse_staff` | `/warehouse/stock` | Warehouse stock |
| `technician` | `/technician` | Technician workspace |
| `road_technician` | `/road-tech` | Road technician workspace |

## Access behavior

- Signed-out users are redirected to `/login`.
- Signed-in users without a matching `public.users` record see Access Pending.
- Non-admin users only see their permitted navigation links.
- Direct URL access to another role's page shows Access Blocked.
- Admin users can see every navigation section and every page.

## UI refinement

The app now uses a dark neumorphic interface with:

- gold accent palette
- raised and inset cards
- role profile chip in the sidebar
- rounded pill feature lists
- animated login button
- polished access-state cards
- responsive single-column mobile layout

The UI is inspired by modern component-gallery patterns such as animated microinteractions and soft neumorphic cards, but no third-party component code has been copied into the repo.

## Remaining hardening

Client-side RBAC improves UX and prevents accidental navigation, but final data security must always be enforced with Supabase RLS policies. The next hardening pass should make RLS role-aware per table and action.
