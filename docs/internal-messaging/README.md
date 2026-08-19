# Internal messaging Phase 1

Internal messaging is an implemented-but-disabled ERP capability. The durable Phase 1 foundation is present in the repository and the production Supabase project; the private-Realtime hardening layer in this branch is **staged only** and must not be applied to production until the acceptance gates pass.

## Current production truth

Read-only reconciliation on 17 August 2026 confirmed:

- `public.message_threads`, `public.message_thread_members` and `public.messages` are present;
- the Phase 1 foundation, supporting indexes and `supabase_realtime` publication are present;
- the private `thread:<uuid>` Realtime authorization policies are not present;
- the committed-message signal trigger is not present;
- general `public.users` and `public.user_details` RLS permits normal staff to read only their own employee/profile rows, so messaging discovery must not depend on direct reads of those tables;
- there are no Supabase development branches available for isolated hosted validation.

No production DDL is applied by this branch.

## Zero-cost project constraint

No additional project cost may be incurred. A paid Supabase development branch is therefore not used for validation.

Authenticated acceptance instead runs against an ephemeral **local Supabase full stack** on the repository's standard public GitHub Actions runner. The job starts local Auth, Postgres, PostgREST and Realtime, uses only synthetic test users, runs the backend and browser acceptance suite, verifies rollback, then destroys the local stack without backup. It does not use production credentials, repository secrets or a hosted Supabase project.

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

## Employee directory boundary

Production RLS intentionally prevents ordinary staff from browsing full `users` and `user_details` records. The secure messaging workspace therefore uses `public.list_internal_messaging_directory()` rather than widening those policies.

The security-definer RPC requires an active authenticated ERP caller and returns only:

- internal user ID;
- work email;
- first name;
- last name.

Inactive users are excluded. Role, branch, phone number, birthday, emergency contacts, access notes and Auth identifiers remain outside the messaging directory contract.

## Realtime security model

The enabled client uses one private `thread:<uuid>` channel per accessible conversation. Membership is authorized by RLS policies on `realtime.messages` for Broadcast and Presence only. The legacy shared `internal-messaging-presence` channel and broad message/thread `postgres_changes` subscriptions are not part of the secure workspace.

The only retained Postgres-change subscription is scoped to the signed-in user's own `message_thread_members` rows so membership changes can refresh the conversation list. Administrators receive no implicit access to private conversations; private access remains based on active thread membership.

## Feature flag

`/work/messages` remains fail-closed unless:

```text
NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED=true
```

`.env.example` remains `false`. Do not enable the flag in production until the hardening migration and authenticated local full-stack acceptance gates have passed and production promotion receives separate explicit approval.

## Repository migrations

Foundation already on `main`:

- `supabase/migrations/20260804094500_add_internal_messaging_phase_1.sql`
- `supabase/migrations/20260804115800_add_internal_messaging_supporting_indexes.sql`
- `supabase/migrations/20260805061000_enable_internal_messaging_realtime.sql`

Staged hardening in this branch:

- `supabase/migrations/20260812083000_harden_internal_messaging_phase_1.sql`
- `supabase/rollback/20260812083000_unharden_internal_messaging_phase_1.sql`

The hardening migration adds only the missing layer: the minimal employee-directory RPC, own-member mute/archive updates, private Realtime topic authorization, committed-message activity timestamps and a body-free committed-message Broadcast signal.

## Validation layers

### Normal application CI

`npm run feature:check` enforces the fail-closed flag, the minimal-directory boundary, private thread channels, scoped membership refresh, body-free signals and the zero-cost local-test safety contract. It rejects a local messaging workflow that introduces GitHub secrets, a production Supabase endpoint or removes local-stack teardown.

### Disposable PostgreSQL hardening validation

`Internal Messaging Hardening Validation` applies the existing foundation plus the staged hardening migration to disposable PostgreSQL 17 fixtures. It verifies:

- active callers can use the minimal employee directory;
- inactive employees are excluded;
- anonymous directory execution is rejected;
- own mute/archive preference updates;
- rejection of another member's preference change;
- member private Realtime authorization;
- non-member private Realtime rejection;
- membership-role escalation rejection;
- body-free committed-message signals;
- thread activity updates;
- rollback removal of the hardening layer and directory RPC.

### Local Supabase full-stack validation

`Internal Messaging Local Full-Stack Validation` uses a pinned Supabase CLI to create a disposable local Supabase project inside CI. It does not require Supabase cloud branching or repository secrets.

The workflow:

1. starts the local Supabase stack;
2. accepts loopback API/database endpoints only;
3. applies a production-shaped minimum ERP identity/profile surface plus the real Auth-link, appearance and messaging migrations;
4. creates three synthetic confirmed Supabase Auth users;
5. links them to complete synthetic ERP profiles;
6. runs authenticated direct/group messaging, RLS isolation, private Presence/typing, committed-message refetch and reconnect recovery tests;
7. builds the ERP with messaging enabled against the local stack only;
8. runs the two-user messaging UI plus desktop/phone/tablet browser tests;
9. verifies the hardening rollback;
10. destroys the local Supabase stack with no backup.

A local full-stack pass is evidence for the repository implementation. It is not a claim that production has been migrated or enabled.

## Production rollout gate

Do not apply the hardening migration or enable internal messaging in production until all of the following are complete:

1. Normal DallmayrERP CI passes on the exact candidate head.
2. Disposable PostgreSQL foundation and hardening validation pass, including rollback.
3. Local Supabase Auth/RLS/private-Realtime backend validation passes on that same candidate.
4. Messaging-enabled desktop/phone/tablet browser acceptance passes against the same local Supabase stack.
5. Local hardening rollback is verified.
6. Production migration impact is reviewed against the read-only reconciled production schema.
7. Production migration receives separate explicit approval.
8. After production migration, Supabase security/performance advisor findings are reviewed before the feature flag is enabled.
9. Production feature enablement receives separate explicit approval.

Until then, the production foundation remains dormant behind the disabled feature flag.
