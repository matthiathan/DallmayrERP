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

The schema draft now includes:

- minimum private-schema usage and function execution privileges
- non-recursive active-membership authorization
- a thread-scoped read-position foreign key that nulls only the message reference
- active-caller and active-recipient checks
- a concurrency-safe direct-thread RPC using an advisory transaction lock
- deterministic direct-thread uniqueness
- explicit revocation of default function execution privileges

The draft is still not approved for deployment. The following work remains:

1. Confirm the target Supabase PostgreSQL version supports column-specific `ON DELETE SET NULL` in the intended environment.
2. Add a reviewed group-thread creation contract with participant-count and owner rules.
3. Write authenticated-role RLS and concurrency tests.
4. Execute the draft only in a disposable/local Postgres environment before producing a migration.
5. Run Supabase security and performance advisors after eventual schema installation.

## Rollout gate

Do not convert the SQL draft into a production migration until:

1. The SQL has been reviewed against the current production schema.
2. Authenticated-role tests have been written and passed.
3. Security and performance advisors are clean or consciously accepted.
4. A disabled feature flag is present in the application.
5. A rollback migration has been prepared.
6. CI and staged browser tests pass.
7. The remaining review items above are resolved.

## Context-aware messaging

ERP-record conversations are a later phase. The first release should prove private user and group messaging before linking threads to service jobs, customers, quotations, stock records or other business entities.
