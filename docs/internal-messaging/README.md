# Internal messaging Phase 1

This branch contains design work only. Nothing in this folder is deployed to Supabase and no `/messages` route is exposed.

## Phase 1 scope

- direct conversations
- group conversations
- text messages only
- unread/read positions
- cursor pagination using `(created_at, id)`
- realtime delivery signals
- presence and typing state
- mute and personal archive state
- existing in-app/browser notification integration

Attachments, editing, deletion, reactions, pins, global search, moderation and native push notifications are deferred.

## Source-of-truth rule

Postgres is authoritative. A message must be committed before any realtime broadcast is emitted. Broadcast and Presence are advisory only; reconnecting clients must always reconcile from Postgres.

## Feature flag

The future application route must remain disabled unless `NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED=true`. The default and production value must remain false until all acceptance gates pass.

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
- removed members lose future access immediately
- administrators do not automatically gain private-conversation access

## Realtime acceptance tests

- member can join a private thread topic
- non-member cannot join the topic
- committed messages are recovered after reconnect
- typing state expires and is never persisted
- Presence contains no message bodies or sensitive record data

## Static review status

The design now includes:

- minimum private-schema usage and function execution privileges
- non-recursive active-membership authorization
- a thread-scoped read-position foreign key that nulls only the message reference
- active-caller and active-recipient checks
- concurrency-safe direct-thread creation using an advisory transaction lock
- deterministic direct-thread uniqueness
- group-thread creation with title, active-member and participant-limit validation
- explicit revocation of default function execution privileges
- an authenticated-role RLS, pagination, idempotency and concurrency test specification

The live Supabase project reports PostgreSQL 17.6, which supports the column-specific foreign-key delete action used by the design.

## Remaining execution gate

The design is still not approved for production deployment. Before conversion into a migration it must be executed and tested in disposable/local Postgres. This chat does not have an accepted local Work environment, so those tests have been specified but not run.

After disposable execution:

1. Correct any SQL or test failures.
2. Generate a timestamped migration through the Supabase CLI.
3. Prepare and verify the down migration.
4. Run Supabase security and performance advisors after installation in a safe test environment.
5. Keep the application feature flag disabled until staged authenticated browser testing passes.

## Rollout gate

Do not apply a production migration or expose `/messages` until:

1. Authenticated-role tests pass in disposable Postgres.
2. Concurrent direct-thread creation produces exactly one thread.
3. Group creation validation passes.
4. Security and performance advisor findings are resolved or explicitly accepted.
5. A disabled application feature flag and rollback migration are present.
6. CI and staged browser tests pass.

## Context-aware messaging

ERP-record conversations are a later phase. The first release should prove private user and group messaging before linking threads to service jobs, customers, quotations, stock records or other business entities.
