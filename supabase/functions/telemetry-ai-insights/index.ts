import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const AI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('AI_API_KEY');
const AI_API_BASE_URL = (Deno.env.get('AI_API_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const AI_MODEL = Deno.env.get('AI_MODEL') ?? Deno.env.get('OPENAI_MODEL') ?? 'gpt-5-mini';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing Supabase Edge Function environment variables.');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const periods = new Set(['day', 'week', 'month', 'six_months']);
const CACHE_TTL_MS = 10 * 60_000;
const MIN_REFRESH_MS = 60_000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function usageBytes(row: Record<string, unknown>) {
  if (numberValue(row.modem_sample_count) > 0) return numberValue(row.measured_modem_bytes);
  if (numberValue(row.device_application_sample_count) > 0) return numberValue(row.device_application_bytes);
  return numberValue(row.application_bytes);
}

function outputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];
    for (const part of content) {
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

function buildEvidence(report: Record<string, any>, dashboard: Record<string, any>, usageRows: Record<string, any>[], balanceRows: Record<string, any>[], scope: Record<string, string>) {
  const states = Array.isArray(dashboard.device_states) ? dashboard.device_states : [];
  const activeFaults = Array.isArray(dashboard.active_faults) ? dashboard.active_faults : [];
  const allowedDeviceIds = new Set(states.map((row: Record<string, unknown>) => String(row.device_id ?? '')).filter(Boolean));
  const scopedUsage = usageRows.filter((row) => allowedDeviceIds.has(String(row.device_id ?? '')));
  const scopedBalances = balanceRows.filter((row) => allowedDeviceIds.has(String(row.device_id ?? '')));
  const offline = states.filter((row: Record<string, unknown>) => row.online === false);
  const wifi = states.filter((row: Record<string, unknown>) => row.last_transport === 'wifi');
  const cellular = states.filter((row: Record<string, unknown>) => row.last_transport === 'cellular');
  const lowWifi = wifi.filter((row: Record<string, unknown>) => typeof row.wifi_rssi === 'number' && Number(row.wifi_rssi) < -75);
  const lowCellular = cellular.filter((row: Record<string, unknown>) => typeof row.cellular_csq === 'number' && Number(row.cellular_csq) < 10);
  const totalUsageBytes = scopedUsage.reduce((sum, row) => sum + usageBytes(row), 0);
  const usageLeaders = [...scopedUsage]
    .sort((left, right) => usageBytes(right) - usageBytes(left))
    .slice(0, 8)
    .map((row) => ({ device_id: row.device_id, bytes_30d: usageBytes(row) }));
  const balanceAlerts = scopedBalances
    .filter((row) => ['low', 'critical', 'depleted', 'stale'].includes(String(row.alert_level ?? '')))
    .slice(0, 10)
    .map((row) => ({ device_id: row.device_id, alert_level: row.alert_level, remaining_bytes: row.remaining_bytes }));

  return {
    generated_for: scope,
    reporting_period: report.period ?? null,
    date_from: report.date_from ?? null,
    date_to: report.date_to ?? null,
    sales_summary: report.summary ?? {},
    daily_trend_recent: Array.isArray(report.daily_trend) ? report.daily_trend.slice(-14) : [],
    top_items: Array.isArray(report.top_items) ? report.top_items.slice(0, 8) : [],
    top_machines: Array.isArray(report.top_machines) ? report.top_machines.slice(0, 8) : [],
    device_health: {
      total: states.length,
      online: states.length - offline.length,
      offline: offline.length,
      wifi: wifi.length,
      cellular: cellular.length,
      transport_unknown: Math.max(0, states.length - wifi.length - cellular.length),
      low_wifi_signal: lowWifi.length,
      low_cellular_signal: lowCellular.length,
      offline_examples: offline.slice(0, 12).map((row: Record<string, unknown>) => ({
        device_id: row.device_id,
        device_code: row.device_code,
        machine_id: row.machine_id,
        machine_name: row.machine_name,
        serial_number: row.serial_number,
        branch: row.branch,
        last_seen_at: row.last_seen_at,
      })),
    },
    active_faults: activeFaults.slice(0, 20),
    data_usage_30d: { total_bytes: totalUsageBytes, highest_usage_devices: usageLeaders },
    prepaid_balance_alerts: balanceAlerts,
  };
}

const insightSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['healthy', 'watch', 'action'] },
    summary: { type: 'string' },
    insights: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info', 'opportunity'] },
          category: { type: 'string', enum: ['fleet_health', 'faults', 'connectivity', 'sales', 'data_usage', 'sim_balance'] },
          title: { type: 'string' },
          evidence: { type: 'string' },
          recommended_action: { type: 'string' },
          machine_id: { type: ['string', 'null'] },
          device_id: { type: ['string', 'null'] },
        },
        required: ['severity', 'category', 'title', 'evidence', 'recommended_action', 'machine_id', 'device_id'],
      },
    },
  },
  required: ['status', 'summary', 'insights'],
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ message: 'POST is required.' }, 405);

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return jsonResponse({ message: 'Authentication is required.' }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return jsonResponse({ message: 'Authentication is required.' }, 401);

  const body = await request.json().catch(() => ({})) as { period?: string; refresh?: boolean };
  const period = periods.has(String(body.period ?? 'week')) ? String(body.period ?? 'week') : 'week';
  const forceRefresh = body.refresh === true;

  const { data: profile, error: profileError } = await supabase
    .from('user_details')
    .select('role,branch')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (profileError || !profile) return jsonResponse({ message: 'An active DallmayrERP user profile is required.' }, 403);

  const branch = String(profile.branch ?? 'national').toLowerCase();
  const role = String(profile.role ?? 'unknown').toLowerCase();
  const branchScope = branch === 'national' ? 'all' : branch;
  const scopeKey = `legacy-branch:${branchScope}`;

  const { data: cached } = await supabase
    .from('telemetry_ai_insight_cache')
    .select('payload,model,generated_at,input_tokens,output_tokens')
    .eq('user_id', authData.user.id)
    .eq('scope_key', scopeKey)
    .eq('period', period)
    .maybeSingle();

  if (cached?.generated_at) {
    const age = Date.now() - new Date(cached.generated_at).getTime();
    if (age < MIN_REFRESH_MS || (!forceRefresh && age < CACHE_TTL_MS)) {
      return jsonResponse({ ...cached.payload, cached: true, generated_at: cached.generated_at, model: cached.model });
    }
  }

  if (!AI_API_KEY) {
    return jsonResponse({
      message: 'AI is not configured on the server. Add OPENAI_API_KEY (or AI_API_KEY) to the Supabase Edge Function secrets.',
      code: 'ai_not_configured',
    }, 503);
  }

  const [reportResult, dashboardResult, usageResult, balanceResult] = await Promise.all([
    supabase.rpc('get_telemetry_reporting', { p_period: period, p_branch: branchScope, p_dataset: 'production' }),
    supabase.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: branchScope }),
    supabase.rpc('get_telemetry_data_usage', { p_days: 30 }),
    supabase.rpc('get_telemetry_prepaid_balances'),
  ]);

  if (reportResult.error || dashboardResult.error) {
    return jsonResponse({ message: 'Could not load authorized telemetry for AI analysis.' }, 503);
  }

  const evidence = buildEvidence(
    (reportResult.data ?? {}) as Record<string, any>,
    (dashboardResult.data ?? {}) as Record<string, any>,
    (usageResult.data ?? []) as Record<string, any>[],
    (balanceResult.data ?? []) as Record<string, any>[],
    { role, branch: branchScope },
  );

  const aiResponse = await fetch(`${AI_API_BASE_URL}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      instructions: [
        'You are the Dallmayr telemetry operations analyst.',
        'Use only the supplied telemetry evidence. Never invent machine states, causes, quantities, faults, or trends.',
        'If evidence is insufficient, say so. Distinguish correlation from confirmed cause.',
        'Prioritize operational risk, offline machines, recurring faults, vend degradation, unusual data usage, weak connectivity, and SIM balance risk.',
        'Recommendations are advisory diagnostic actions only; never claim that you changed a machine or device.',
        'Use concise South African business English. Revenue values are supplied in cents and represent ZAR.',
      ].join(' '),
      input: JSON.stringify(evidence),
      max_output_tokens: 1800,
      text: {
        format: {
          type: 'json_schema',
          name: 'dallmayr_telemetry_insights',
          strict: true,
          schema: insightSchema,
        },
      },
    }),
  });

  const aiPayload = await aiResponse.json().catch(() => ({})) as Record<string, any>;
  if (!aiResponse.ok) {
    console.error('AI provider error', aiResponse.status, aiPayload?.error?.type ?? 'unknown');
    return jsonResponse({ message: 'The AI insight service is temporarily unavailable.' }, 502);
  }

  const text = outputText(aiPayload);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonResponse({ message: 'The AI provider returned an invalid structured response.' }, 502);
  }

  const generatedAt = new Date().toISOString();
  const usage = aiPayload.usage ?? {};
  await supabase.from('telemetry_ai_insight_cache').upsert({
    user_id: authData.user.id,
    scope_key: scopeKey,
    period,
    payload: parsed,
    model: AI_MODEL,
    input_tokens: numberValue(usage.input_tokens) || null,
    output_tokens: numberValue(usage.output_tokens) || null,
    generated_at: generatedAt,
    updated_at: generatedAt,
  }, { onConflict: 'user_id,scope_key,period' });

  return jsonResponse({ ...parsed, cached: false, generated_at: generatedAt, model: AI_MODEL });
});
