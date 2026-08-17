import { readFile } from 'node:fs/promises';
import process from 'node:process';

const [page, secureWorkspace, envExample, hardeningMigration, stagedWorkflow] = await Promise.all([
  readFile('app/work/messages/page.tsx', 'utf8'),
  readFile('components/features/SecureInternalMessagingWorkspace.tsx', 'utf8'),
  readFile('.env.example', 'utf8'),
  readFile('supabase/migrations/20260812083000_harden_internal_messaging_phase_1.sql', 'utf8'),
  readFile('.github/workflows/internal-messaging-staged.yml', 'utf8'),
]);

function fail(message) {
  console.error(`Internal messaging security check failed: ${message}`);
  process.exitCode = 1;
}

if (!page.includes("process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED !== 'true'")) {
  fail('/work/messages must remain fail-closed unless the public feature flag is exactly true.');
}
if (!page.includes("@/components/features/SecureInternalMessagingWorkspace")) {
  fail('/work/messages must render the secure internal messaging workspace when enabled.');
}
if (/from ['"]@\/components\/features\/InternalMessagingWorkspace['"]/.test(page)) {
  fail('/work/messages must not restore the legacy global-Realtime workspace.');
}
if (!/^NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED=false$/m.test(envExample)) {
  fail('internal messaging must remain disabled by default in .env.example.');
}

if (!secureWorkspace.includes('private: true')) {
  fail('messaging Realtime channels must be private.');
}
if (!secureWorkspace.includes('thread:${')) {
  fail('messaging Realtime topics must be thread-scoped.');
}
if (secureWorkspace.includes('internal-messaging-presence')) {
  fail('the legacy shared presence channel must not return.');
}

const postgresChangeCount = (secureWorkspace.match(/['"]postgres_changes['"]/g) ?? []).length;
if (postgresChangeCount > 1) {
  fail('the secure client may use only one scoped membership postgres_changes subscription.');
}
if (postgresChangeCount === 1) {
  if (!secureWorkspace.includes("table: 'message_thread_members'") ||
      !secureWorkspace.includes('filter: `user_id=eq.${businessUser.id}`')) {
    fail('the only permitted postgres_changes subscription must be filtered to the current user membership row.');
  }
  if (/['"]postgres_changes['"][\s\S]{0,240}table:\s*['"](?:messages|message_threads)['"]/.test(secureWorkspace)) {
    fail('broad message or thread postgres_changes subscriptions must not return.');
  }
}
if (!secureWorkspace.includes('message_committed')) {
  fail('the secure client must reconcile committed-message signals from Postgres.');
}

if (!hardeningMigration.includes('internal_messaging_realtime_thread_read') ||
    !hardeningMigration.includes('internal_messaging_realtime_thread_write')) {
  fail('the hardening migration must authorize private Realtime thread topics.');
}
if (!hardeningMigration.includes("realtime.messages.extension in ('broadcast', 'presence')")) {
  fail('Realtime authorization must be limited to Broadcast and Presence extensions.');
}
if (!hardeningMigration.includes('private.handle_committed_internal_message')) {
  fail('the hardening migration must emit committed-message signals from a private trigger function.');
}
const sendBlock = hardeningMigration.match(/perform realtime\.send\([\s\S]*?\n\s*\);/)?.[0] ?? '';
if (!sendBlock || /['"]body['"]/.test(sendBlock)) {
  fail('the committed-message Realtime payload must exist and must not contain a message body field.');
}

if (!stagedWorkflow.includes('https://egbiiizxsqlarqpnzxxs.supabase.co')) {
  fail('staged validation must explicitly refuse the production Supabase URL.');
}
if (!stagedWorkflow.includes('authenticated staged validation is intentionally skipped')) {
  fail('staged validation must clearly distinguish missing staging inputs from a functional pass.');
}

if (!process.exitCode) {
  console.log('Internal messaging security contracts passed: fail-closed flag, private thread channels, scoped membership refresh, body-free signals and staging isolation are enforced.');
}
