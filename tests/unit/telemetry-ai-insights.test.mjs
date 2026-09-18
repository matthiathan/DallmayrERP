import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const edgeFunction = readFileSync(new URL('../../supabase/functions/telemetry-ai-insights/index.ts', import.meta.url), 'utf8');
const aiComponent = readFileSync(new URL('../../components/telemetry-platform/TelemetryAiInsights.tsx', import.meta.url), 'utf8');
const aiStyles = readFileSync(new URL('../../components/telemetry-platform/TelemetryAiInsights.module.css', import.meta.url), 'utf8');

test('telemetry AI requires an authenticated user before loading telemetry evidence', () => {
  assert.match(edgeFunction, /authorization\.startsWith\('Bearer '\)/);
  assert.match(edgeFunction, /supabase\.auth\.getUser\(\)/);
  assert.match(edgeFunction, /An active DallmayrERP user profile is required/);
});

test('telemetry AI resolves auth users through the internal application user mapping', () => {
  assert.match(edgeFunction, /supabase\.rpc\('current_app_user_id'\)/);
  assert.match(edgeFunction, /supabase\.rpc\('current_app_role'\)/);
  assert.match(edgeFunction, /\.from\('user_details'\)[\s\S]*?\.eq\('user_id', appUserId\)/);
  assert.match(edgeFunction, /\.from\('telemetry_ai_insight_cache'\)[\s\S]*?\.eq\('user_id', authData\.user\.id\)/);
  assert.match(aiComponent, /client\.rpc\('current_app_role'\)/);
  assert.doesNotMatch(aiComponent, /\.eq\('user_id', authData\.user\.id\)/);
});

test('machine AI verifies visibility and prefers complete period sales evidence', () => {
  assert.match(edgeFunction, /requested machine is not available in your telemetry scope/i);
  assert.match(edgeFunction, /telemetry_daily_item_sales/);
  assert.match(edgeFunction, /completeMachineSalesEvidence/);
  assert.match(edgeFunction, /complete_period_totals: true/);
  assert.match(edgeFunction, /sample_only: true/);
});

test('AI generations stay manual and expose supported analysis periods', () => {
  assert.match(aiComponent, /Generate AI insights/);
  assert.match(aiComponent, /Refresh AI insights/);
  assert.match(aiComponent, /value: 'day', label: 'Today'/);
  assert.match(aiComponent, /value: 'week', label: 'Last 7 days'/);
  assert.match(aiComponent, /value: 'month', label: 'Last 30 days'/);
  assert.match(aiComponent, /value: 'six_months', label: 'Last 6 months'/);
  assert.doesNotMatch(aiComponent, /useEffect\([^)]*generate/);
});

test('AI client surfaces the Edge Function response message instead of the generic non-2xx error', () => {
  assert.match(aiComponent, /FunctionsHttpError/);
  assert.match(aiComponent, /error\.context\.json\(\)/);
  assert.match(aiComponent, /payload\.message\.trim\(\)/);
  assert.match(aiComponent, /requestErrorMessage\(invokeError\)/);
});

test('AI branding uses Dallmayr gold and keeps red for actual failure states only', () => {
  assert.match(aiStyles, /\.actions button\s*\{[^}]*background:\s*#b89b5e/s);
  assert.match(aiStyles, /\.eyebrow\s*\{[^}]*color:\s*#7f683b/s);
  assert.doesNotMatch(aiStyles, /#bd0f22/i);
  assert.match(aiStyles, /Red is intentionally reserved for an actual AI request\/service failure/);
  assert.match(aiStyles, /\.error\s*\{[^}]*#8c1f2b/s);
  assert.match(aiStyles, /\.eventFailure\s*\{[^}]*#8c1f2b/s);
});

test('AI service activity is admin-only in the client and records failure telemetry separately', () => {
  assert.match(aiComponent, /toLowerCase\(\) !== 'admin'/);
  assert.match(aiComponent, /telemetry_ai_generation_log/);
  assert.match(aiComponent, /event_type === 'failure'/);
  assert.match(aiComponent, /Failures · 24h/);
});
