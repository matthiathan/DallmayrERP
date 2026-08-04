-- TEST SPECIFICATION ONLY. Run only against disposable/local Postgres.
-- This file intentionally contains no production credentials or fixed user IDs.
-- Replace placeholders with disposable fixtures created inside a rolled-back test transaction.

-- Required fixtures
-- active_member_a, active_member_b, active_non_member, inactive_user, admin_non_member
-- direct_thread_ab, group_thread_ab, messages in both threads

-- 1. Active member visibility
-- set local role authenticated;
-- set local request.jwt.claim.sub = '<auth uid for active_member_a>';
-- expect: member can select own direct/group threads, memberships, messages and audit events.

-- 2. Non-member isolation
-- set local request.jwt.claim.sub = '<auth uid for active_non_member>';
-- expect zero rows for another thread across all messaging tables.
-- expect insert into messages for another thread to fail RLS.

-- 3. Inactive-user isolation
-- set local request.jwt.claim.sub = '<auth uid for inactive_user>';
-- expect zero rows and all message/read-position writes rejected.
-- expect create_direct_message_thread and create_group_message_thread to reject caller.

-- 4. Sender impersonation
-- authenticate as active_member_a.
-- insert a message with sender_id = active_member_b.
-- expect RLS rejection.

-- 5. Read-position ownership and thread scope
-- authenticate as active_member_a.
-- expect own read position insert/update to succeed for a joined thread.
-- expect update of active_member_b's read position to fail.
-- expect a last_read_message_id from another thread to fail the composite FK.
-- delete the referenced message and verify only last_read_message_id becomes null.

-- 6. Removed membership
-- set removed_at for active_member_a in a test transaction using a privileged fixture step.
-- authenticate as active_member_a.
-- expect immediate loss of reads, sends, audit access and read-position updates.

-- 7. Administrator privacy
-- authenticate as admin_non_member.
-- expect no automatic visibility into private threads.

-- 8. Direct-thread idempotency
-- authenticate as active_member_a.
-- call create_direct_message_thread(active_member_b) twice.
-- expect the same thread UUID and exactly two active membership rows.

-- 9. Concurrent direct-thread creation
-- from two independent transactions, authenticate as A and B and call the RPC simultaneously.
-- expect both calls to return the same UUID.
-- expect one direct_key row, two memberships and no duplicate thread.

-- 10. Group-thread contract
-- authenticate as active_member_a.
-- expect trimmed valid title and deduplicated active member IDs.
-- expect caller to be owner and selected users to be members.
-- expect rejection for empty title, self-only group, inactive/unknown member or >50 total members.

-- 11. Message idempotency
-- authenticate as active_member_a.
-- insert the same client_message_id twice.
-- expect one committed message or a unique-constraint result suitable for client reconciliation.

-- 12. Cursor pagination
-- create more than 100 ordered messages with tied timestamps included.
-- fetch newest page using (created_at, id), then subsequent pages.
-- expect newest messages first at query time, chronological rendering, no gaps and no duplicates.

-- 13. Function privilege tests
-- as anon: expect execute denied for both creation RPCs and the private helper.
-- as authenticated: expect only public creation RPCs callable directly.
-- verify the private schema is not exposed through the Data API.

-- 14. Rollback verification
-- run the eventual down migration in disposable Postgres.
-- expect messaging tables, policies and functions removed without affecting existing ERP tables.
