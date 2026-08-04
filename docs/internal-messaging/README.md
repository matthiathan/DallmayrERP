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
- newest-page pagination has no gaps or duplicates
- removed members lose future access immediately
- administrators do not automatically gain private-conversation access

## Realtime acceptance tests

- member can join a private thread topic
- non-member cannot join the topic
- committed messages are recovered after reconnect
- typing state expires and is never persisted
- Presence contains no message bodies or sensitive record data

## Rollout gate

Do not convert the SQL draft into a production migration until:

1. The SQL has been reviewed against the current production schema.
2. Authenticated-role tests have been written.
3. Security and performance advisors are clean or consciously accepted.
4. A disabled feature flag is present in the application.
5. A rollback migration has been prepared.
6. CI and staged browser tests pass.

## Context-aware messaging

ERP-record conversations are a later phase. The first release should prove private user and group messaging before linking threads to service jobs, customers, quotations, stock records or other business entities.
