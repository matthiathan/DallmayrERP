import { readFile } from 'node:fs/promises';
import process from 'node:process';

const [page, secureWorkspace, envExample, hardeningMigration, localWorkflow, seedScript, nextConfig] = await Promise.all([
  readFile('app/work/messages/page.tsx', 'utf8'),
  readFile('components/features/SecureInternalMessagingWorkspace.tsx', 'utf8'),
  readFile('.env.example', 'utf8'),
  readFile('supabase/migrations/20260812083000_harden_internal_messaging_phase_1.sql', 'utf8'),
  readFile('.github/workflows/internal-messaging-staged.yml', 'utf8'),
  readFile('scripts/seed-local-messaging-users.mjs', 'utf8'),
  readFile('next.config.ts', 'utf8'),
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
if (!secureWorkspace.includes("rpc('list_internal_messaging_directory')")) {
  fail('the secure client must load its employee directory through the minimal messaging directory RPC.');
}
if (/\.from\(['"](?:users|user_details)['"]\)/.test(secureWorkspace)) {
  fail('the secure messaging client must not bypass employee-profile RLS with direct users/user_details directory reads.');
}

if (!hardeningMigration.includes('list_internal_messaging_directory')) {
  fail('the hardening migration must define the minimal active-employee messaging directory RPC.');
}
if (!hardeningMigration.includes('returns table(') ||
    !hardeningMigration.includes('user_id uuid') ||
    !hardeningMigration.includes('first_name text') ||
    !hardeningMigration.includes('last_name text')) {
  fail('the messaging directory RPC must expose only its minimal addressing shape.');
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

if (!nextConfig.includes("if (url.protocol === 'https:') url.protocol = 'wss:';") ||
    !nextConfig.includes("else if (url.protocol === 'http:') url.protocol = 'ws:';")) {
  fail('Supabase CSP Realtime origins must map HTTPS to WSS and HTTP to WS.');
}
if (!nextConfig.includes('supabaseRealtimeOrigin') || !nextConfig.includes('connectSources')) {
  fail('the protocol-matched Supabase Realtime origin must be included in CSP connect-src.');
}

if (!localWorkflow.includes('Internal Messaging Local Full-Stack Validation')) {
  fail('authenticated messaging validation must run against an ephemeral local Supabase full stack.');
}
if (!localWorkflow.includes('supabase/setup-cli@v1') || !localWorkflow.includes('version: 2.111.0')) {
  fail('the local full-stack validation must use the pinned Supabase CLI.');
}
if (!localWorkflow.includes('supabase start') || !localWorkflow.includes('supabase stop --no-backup')) {
  fail('the local full-stack validation must create and destroy its disposable Supabase stack.');
}
if (!localWorkflow.includes('http://127.0.0.1:') || !localWorkflow.includes('Refusing non-local Supabase API URL')) {
  fail('the local full-stack validation must enforce loopback-only Supabase endpoints.');
}
if (/\$\{\{\s*secrets\./.test(localWorkflow)) {
  fail('zero-cost local messaging validation must not depend on repository or environment secrets.');
}
if (localWorkflow.includes('egbiiizxsqlarqpnzxxs.supabase.co')) {
  fail('the zero-cost local messaging workflow must never target the production Supabase project.');
}
if (!localWorkflow.includes('validate-staged-messaging.mjs') || !localWorkflow.includes('messaging-staged.spec.mjs')) {
  fail('the local full-stack workflow must execute authenticated backend/Realtime and browser acceptance tests.');
}
if (!seedScript.includes('auth.admin.createUser')) {
  fail('the local full-stack test must create real synthetic Supabase Auth users.');
}
if (/supabase\.co/.test(seedScript)) {
  fail('the local synthetic-user seed script must not contain a hosted Supabase endpoint.');
}

if (!process.exitCode) {
  console.log('Internal messaging security contracts passed: fail-closed feature flag, minimal directory RPC, private thread Realtime, scoped membership refresh, body-free signals, protocol-matched CSP and zero-cost loopback-only full-stack validation are enforced.');
}
