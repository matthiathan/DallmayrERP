# Internal messaging Phase 1

Internal messaging is an implemented-but-disabled ERP capability. The durable Phase 1 foundation is present in the repository and the production Supabase project; the private-Realtime hardening layer in this branch is **staged only** and must not be applied to production until the staged acceptance gates pass.

## Current production truth

Read-only reconciliation on 17 August 2026 confirmed:

- `public.message_threads`, `public.message_thread_members` and `public.messages` are present;
- the Phase 1 foundation, supporting indexes and `supabase_realtime` publication are present;
- the private `thread:<uuid>` Realtime authorization policies are not present;
- the committed-message signal trigger is not present;
- there are no Supabase development branches available for isolated authenticated validation.

No production DDL is applied by this branch.

## Phase 1 scope

- direct conversations
- group conversations
- text messages only
- unread/read positions
- cursor pagination using `(created_at, id)`
- private thread-scoped Realtime delivery signals
- private thread-scoped Presence and typing state
- mute and personal archive state
- privacy-preserving browser notifications

Attachments, editing, deletion, reactions, pins, global search, moderation, native push notifications and ERP-record conversations are deferred.

## Source-of-truth rule

Postgres is authoritative. Durable messages are written to `public.messages` first. Realtime Broadcast and Presence are advisory only; reconnecting clients reconcile from Postgres under the existing messaging RLS policies.

The hardening migration emits only message identifiers/timestamps on `message_committed`; message bodies remain in Postgres and are not placed in Broadcast, Presence or browser notification text.

## Realtime security model

The enabled client uses one private `thread:<uuid>` channel per accessible conversation. Membership is authorized by RLS policies on `realtime.messages` for Broadcast and Presence only. The legacy shared `internal-messaging-presence` channel and broad client `postgres_changes` subscriptions are not part of the secure workspace.

Administrators receive no implicit access to private conversations. Access remains based on active thread membership.

## Feature flag

`/work/messages` remains fail-closed unless:

```text
NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED=true
```

`.env.example` remains `false`. Do not enable the flag in production until the hardening migration and authenticated staged tests have passed in an isolated non-production Supabase environment.

## Repository migrations

Foundation already on `main`:

- `supabase/migrations/20260804094500_add_internal_messaging_phase_1.sql`
- `supabase/migrations/20260804115800_add_internal_messaging_supporting_indexes.sql`
- `supabase/migrations/20260805061000_enable_internal_messaging_realtime.sql`

Staged hardening in this branch:

- `supabase/migrations/20260812083000_harden_internal_messaging_phase_1.sql`
- `supabase/rollback/20260812083000_unharden_internal_messaging_phase_1.sql`

The hardening migration adds only the missing layer: own-member mute/archive updates, private Realtime topic authorization, committed-message activity timestamps and a body-free committed-message Broadcast signal.

## Validation layers

### Normal application CI

`npm run feature:check` enforces the fail-closed flag and secure messaging source contracts. It also syntax-checks the staged backend and Playwright harnesses.

### Disposable PostgreSQL hardening validation

`Internal Messaging Hardening Validation` applies the existing foundation plus the staged hardening migration to disposable PostgreSQL 17 fixtures. It verifies:

- own mute/archive preference updates;
- rejection of another member's preference change;
- member private Realtime authorization;
- non-member private Realtime rejection;
- membership-role escalation rejection;
- body-free committed-message signals;
- thread activity updates;
- rollback removal of the hardening layer.

### Authenticated staged validation

`Internal Messaging Staged Auth Validation` requires a dedicated non-production Supabase URL/key and three staged users. It explicitly refuses the production DallmayrERP project URL.

When those staging secrets do not exist, the workflow reports that authenticated staged validation is **intentionally skipped**. A skipped staged run is not a functional pass.

When configured, staged validation covers direct-thread idempotency, non-member isolation, private Presence/typing, committed-message refetch, reconnect recovery, read-position ownership, mute/archive behavior, group creation and desktop/phone/tablet browser flows.

## Production rollout gate

Do not apply the hardening migration or enable internal messaging in production until all of the following are complete:

1. Normal DallmayrERP CI passes on the exact candidate head.
2. Disposable PostgreSQL hardening validation passes, including rollback.
3. An isolated non-production Supabase environment exists.
4. The hardening migration is applied to that environment only.
5. Three representative staged users are configured.
6. Authenticated backend, private Realtime/reconnect and browser tests pass there.
7. Rollback is verified in the staged environment.
8. Supabase security/performance advisor findings for the staged hardening are resolved or explicitly accepted.
9. Production migration and feature enablement receive a separate explicit approval.

Until then, the production foundation remains dormant behind the disabled feature flag.
