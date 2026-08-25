import { createClient } from 'npm:@supabase/supabase-js@2.112.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Missing Supabase Edge Function environment variables.');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-device-id, x-device-key, x-firmware-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function johannesburgParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: value('year'), month: value('month'), day: value('day') };
}

function dateKey(date: Date) {
  const p = johannesburgParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function monthKey(date: Date) {
  const p = johannesburgParts(date);
  return `${p.year}-${p.month}`;
}

function counterDue(mode: string, intervalMinutes: number, lastCounterAt: string | null) {
  if (!lastCounterAt) return true;
  const now = new Date();
  const last = new Date(lastCounterAt);
  if (mode === 'daily') return dateKey(last) < dateKey(now);
  if (mode === 'monthly') return monthKey(last) < monthKey(now);
  return now.getTime() - last.getTime() >= intervalMinutes * 60_000;
}

function intervalDue(intervalMinutes: number, lastAt: string | null) {
  return !lastAt || Date.now() - new Date(lastAt).getTime() >= intervalMinutes * 60_000;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ accepted: false, message: 'POST is required.' }, 405);

  const deviceCode = (request.headers.get('x-device-id') ?? '').trim();
  const deviceKey = request.headers.get('x-device-key') ?? '';
  if (!deviceCode || !deviceKey) return jsonResponse({ accepted: false, message: 'Device credentials are required.' }, 401);

  const { data: device, error: deviceError } = await supabase
    .from('telemetry_devices')
    .select('id,device_code,status,credential_hash,machine_id,site_id,profile_id,last_counter_at,last_heartbeat_at,transport_preference,wifi_enabled,cellular_enabled,location_enabled,location_interval_minutes,location_min_move_m,last_location_at')
    .eq('device_code', deviceCode)
    .maybeSingle();

  if (deviceError) return jsonResponse({ accepted: false, message: 'Telemetry configuration service is temporarily unavailable.' }, 503);
  if (!device || device.status !== 'active') return jsonResponse({ accepted: false, message: 'Unknown or inactive telemetry device.' }, 401);
  if (!constantTimeEqual(await sha256Hex(deviceKey), device.credential_hash)) return jsonResponse({ accepted: false, message: 'Invalid telemetry device credentials.' }, 401);

  const { data: policy, error: policyError } = await supabase.rpc('get_effective_telemetry_policy', {
    p_device_id: device.id,
  });
  if (policyError || !policy) return jsonResponse({ accepted: false, message: 'Could not resolve telemetry policy.' }, 503);

  const mode = String(policy.mode ?? 'live');
  const counterIntervalMinutes = Number(policy.counter_interval_minutes ?? 5);
  const heartbeatIntervalMinutes = Number(policy.heartbeat_interval_minutes ?? 10);
  const configRefreshMinutes = Number(policy.config_refresh_minutes ?? 5);
  const locationIntervalMinutes = Math.max(1, Number(device.location_interval_minutes ?? 15));

  const { data: prepaidBalance, error: prepaidBalanceError } = await supabase
    .from('telemetry_prepaid_balance_state')
    .select('carrier,ussd_code,query_status,checked_at,request_pending,check_interval_minutes,stale_after_minutes')
    .eq('device_id', device.id)
    .maybeSingle();
  if (prepaidBalanceError) {
    return jsonResponse({ accepted: false, message: 'Could not resolve prepaid balance monitoring.' }, 503);
  }
  const prepaidCheckIntervalMinutes = Math.max(15, Number(prepaidBalance?.check_interval_minutes ?? 360));
  const prepaidStaleAfterMinutes = Math.max(
    prepaidCheckIntervalMinutes,
    Number(prepaidBalance?.stale_after_minutes ?? 720),
  );
  const prepaidBalanceDue = Boolean(prepaidBalance?.request_pending)
    || intervalDue(prepaidCheckIntervalMinutes, prepaidBalance?.checked_at ?? null);

  await supabase.from('telemetry_devices').update({ last_config_at: new Date().toISOString() }).eq('id', device.id);

  return jsonResponse({
    accepted: true,
    schema: 3,
    server_time: new Date().toISOString(),
    device_id: device.device_code,
    assignment: {
      machine_id: device.machine_id,
      site_id: device.site_id ?? policy.site_id ?? null,
      profile_id: device.profile_id,
    },
    policy: {
      id: policy.id,
      code: policy.policy_code,
      name: policy.name,
      source: policy.source,
      mode,
      counter_interval_minutes: counterIntervalMinutes,
      heartbeat_interval_minutes: heartbeatIntervalMinutes,
      config_refresh_minutes: configRefreshMinutes,
      fault_reporting_immediate: Boolean(policy.fault_reporting_immediate),
      recovery_reporting_immediate: Boolean(policy.recovery_reporting_immediate),
      diagnostic_summary_interval_hours: Number(policy.diagnostic_summary_interval_hours ?? 24),
      updated_at: policy.updated_at,
    },
    control: {
      transport_preference: device.transport_preference ?? 'auto',
      wifi_enabled: Boolean(device.wifi_enabled),
      cellular_enabled: Boolean(device.cellular_enabled),
      cellular_profile: {
        carrier: 'Vodacom South Africa',
        apn: 'internet',
        username: 'guest',
        password: '',
        authentication: 'pap',
        mcc: '655',
        mnc: '01',
      },
      prepaid_balance: {
        enabled: true,
        carrier: prepaidBalance?.carrier ?? 'Vodacom South Africa',
        ussd_code: prepaidBalance?.ussd_code ?? '*111*502#',
        check_interval_minutes: prepaidCheckIntervalMinutes,
        stale_after_minutes: prepaidStaleAfterMinutes,
        last_query_status: prepaidBalance?.query_status ?? 'unknown',
      },
      location: {
        enabled: Boolean(device.location_enabled),
        interval_minutes: locationIntervalMinutes,
        min_move_m: Number(device.location_min_move_m ?? 50),
      },
    },
    actions: {
      counter_due: counterDue(mode, counterIntervalMinutes, device.last_counter_at),
      heartbeat_due: intervalDue(heartbeatIntervalMinutes, device.last_heartbeat_at),
      location_due: Boolean(device.location_enabled) && intervalDue(locationIntervalMinutes, device.last_location_at),
      prepaid_balance_due: prepaidBalanceDue,
    },
    test_environment: {
      safe_payload_type: 'simulation_snapshot',
      production_totals_affected: false,
      usage_reporting: {
        counter_epoch: 'data_usage.counter_epoch',
        application_transmit_total: 'data_usage.application_tx_bytes_total',
        application_receive_total: 'data_usage.application_rx_bytes_total',
        modem_transmit_total: 'data_usage.modem_tx_bytes_total',
        modem_receive_total: 'data_usage.modem_rx_bytes_total',
      },
    },
  });
});
