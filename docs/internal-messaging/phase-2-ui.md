# Internal messaging Phase 2 UI

The `/messages` route is guarded by `NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED=true` and is not added to navigation in this phase.

Implemented:

- direct and group conversation creation through the validated Phase 1 RPCs;
- text-only messages with client-generated idempotency UUIDs;
- newest-first database retrieval limited to 50 messages, rendered chronologically;
- RLS-authorised direct table reads and inserts;
- Postgres Changes reconciliation for messages and memberships;
- responsive desktop/mobile workspace.

Deliberately excluded:

- attachments, edits, deletion, reactions and pins;
- public navigation links or notification-inbox integration;
- optimistic authoritative state;
- native push notifications.

Realtime events are treated only as refresh signals. Postgres remains authoritative and every event causes an RLS-filtered reload.

Before enabling the feature flag:

1. CI, TypeScript, style architecture and production build must pass.
2. Authenticated browser tests must cover two active users and one non-member.
3. Verify the production Realtime publication includes `messages` and `message_thread_members`.
4. Verify directory visibility is appropriate for all ERP roles.
5. Verify newest-page ordering, duplicate-send reconciliation and reconnect recovery.
