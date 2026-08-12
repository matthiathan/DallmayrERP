# Internal messaging Phase 1

## Current implementation status

The durable Phase 1 messaging foundation already exists in the repository and is present in the current Supabase project. The secure replacement client and the hardening migration in `feature/secure-messaging-phase-1` are **not** approved for production yet and remain behind an explicit opt-in feature flag.

This phase is deliberately text-only and privacy-first. Postgres remains the source of truth; Realtime is advisory and never replaces durable message reads.

## Phase 1 scope

- direct conversations
- group conversations
- text messages only
- unread/read positions
- cursor pagination using `(created_at, id)`
- private per-thread Realtime Broadcast delivery signals
- private per-thread Presence and typing state
- mute and personal archive state
- browser notifications without message-body content

Attachments, editing, deletion, reactions, pins, global message search, moderation and native push notifications are deferred.

## Source-of-truth rule

Postgres is authoritative. A message must be committed before any Realtime signal is visible. The database emits only a minimal `{thread_id, message_id, created_at}` reconciliation signal. Clients refetch the committed `public.messages` row under RLS. Broadcast and Presence are advisory only; reconnecting clients always reconcile from Postgres.

## Feature flag

Messaging is enabled only when `NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED=true` exactly. Undefined, empty and all other values resolve to disabled. The default example value is false and must stay false until all acceptance gates pass.

## Existing durable security model

The base migration provides:

- `message_threads`
- `message_thread_members`
- `messages`
- `message_read_positions`
- `message_audit_events`
- RLS on every messaging table
- sender identity derived from `public.current_app_user_id()`
- concurrency-safe direct-thread creation
- deterministic direct-thread uniqueness
- group creation with active-user validation and a 50-user maximum
- `(thread_id, created_at desc, id desc)` cursor support
- rollback scripts and disposable Postgres contract tests

Administrators do not receive implicit access to private conversations.

## Phase 1 hardening in this branch

`20260812083000_harden_internal_messaging_phase_1.sql` adds the missing runtime contracts found during the repository/live-schema audit:

1. Members may update only their own `is_muted` and `archived_at` columns. No grant permits client changes to `member_role`, `removed_at`, membership identity or join time.
2. `realtime.messages` authorizes Broadcast and Presence only when the authenticated ERP user is an active member of the requested `thread:<uuid>` topic.
3. A committed message advances `message_threads.last_message_at` and `updated_at`.
4. The same post-insert trigger emits a private `message_committed` signal without the message body.
5. The secure client subscribes to private per-thread channels, uses Presence only for user identity/online state, uses Broadcast for typing and committed-message signals, and refetches messages from Postgres.
6. Older history is loaded with `(created_at, id)` cursor pagination instead of a fixed oldest-page query.

The previous global Presence/typing channel is not used by the secure client.

## Database acceptance tests

- active member can read a thread
- active member can send a message
- non-member cannot read or send
- inactive user cannot access messaging
- sender identity cannot be impersonated
- a user cannot update another user's read position
- duplicate client message IDs are idempotent per sender
- direct conversation creation is idempotent for the same user pair
- concurrent direct-thread requests return one thread
- group creation validates title, active users, deduplication and the 50-user maximum
- newest-page pagination has no gaps or duplicates
- removed members lose future Postgres access immediately
- administrators do not automatically gain private-conversation access
- own mute/archive update succeeds, another member's preference cannot be changed
- membership role cannot be changed through the preference grant
- a non-member cannot authorize a private Realtime thread topic
- a committed message advances thread activity
- the database Realtime signal contains no message body

## Realtime acceptance tests

Before production rollout, staged authenticated testing must prove:

- member can join a private `thread:<uuid>` topic
- non-member subscription is rejected
- committed messages are recovered from Postgres after reconnect
- typing state expires and is never persisted
- Presence contains only user ID, display label and online timestamp
- muted threads suppress browser notifications
- message bodies are never placed in Presence or external browser-notification text

Supabase Realtime Authorization caches channel permissions for the life of a connection until auth refresh. The application therefore treats Broadcast as a non-sensitive signal only; message content always requires a fresh RLS-protected Postgres read.

## Staged authenticated validation harness

The branch contains a manual-only staged validation gate. It is intentionally not triggered by pull requests and refuses to run against the production DallmayrERP Supabase URL.

- `scripts/validate-staged-messaging.mjs` signs in three representative ERP users and validates direct-thread idempotency, non-member Postgres isolation, private Realtime rejection, Presence, typing Broadcast, committed-message reconciliation, reconnect recovery, read-position ownership, mute/archive preferences and group creation.
- `tests/messaging-staged.spec.mjs` signs in through the real application, verifies two authenticated users can exchange a committed message through `/work/messages`, and checks the messaging workspace for horizontal-overflow regressions on desktop, phone and tablet viewports.
- `.github/workflows/internal-messaging-staged.yml` runs both layers only when explicitly dispatched with dedicated staging secrets.

Required GitHub staging secrets are:

- `STAGED_SUPABASE_URL`
- `STAGED_SUPABASE_KEY`
- `STAGED_USER_A_EMAIL` / `STAGED_USER_A_PASSWORD`
- `STAGED_USER_B_EMAIL` / `STAGED_USER_B_PASSWORD`
- `STAGED_USER_C_EMAIL` / `STAGED_USER_C_PASSWORD`

The three staged users must exist in Supabase Auth and have matching active `public.users` records. Their ERP profiles must be complete enough to pass the normal application authentication/onboarding gate. The isolated Supabase environment must contain the existing Phase 1 foundation plus the hardening migration from this branch before the staged workflow is dispatched.

Do not point this workflow at the live DallmayrERP project and do not repurpose the Concentrix project as a messaging stage.

## Rollout gate

Do not apply the new hardening migration or enable the route in production until:

1. The existing foundation tests and the hardening workflow pass in disposable Postgres.
2. TypeScript, production build, security and browser CI pass.
3. Private Realtime topic authorization is tested with representative authenticated users.
4. Reconnect catches up from Postgres without gaps or duplicates.
5. Security/performance advisor findings are resolved or explicitly accepted.
6. The hardening rollback is verified.
7. Staged authenticated desktop/tablet/mobile messaging testing is signed off.

## Context-aware messaging

ERP-record conversations are a later phase. The first release must prove private user and group messaging before linking threads to service jobs, customers, quotations, stock records or other business entities.
