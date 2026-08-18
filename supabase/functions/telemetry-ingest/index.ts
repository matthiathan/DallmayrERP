import { createClient } from 'npm:@supabase/supabase-js@2.112.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_BODY_BYTES = 16 * 1024;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Missing Supabase Edge Function environment variables.');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-device-id, x-device-key, x-firmware-version',
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

function intOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedSerial(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validDateOrNull(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ accepted: false, message: 'POST is required.' }, 405);

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return jsonResponse({ accepted: false, message: 'Payload is too large.' }, 413);

  const deviceCode = (request.headers.get('x-device-id') ?? '').trim();
  const deviceKey = request.headers.get('x-device-key') ?? '';
  if (!deviceCode || !deviceKey) return jsonResponse({ accepted: false, message: 'Device credentials are required.' }, 401);

  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) return jsonResponse({ accepted: false, message: 'Payload is too large.' }, 413);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return jsonResponse({ accepted: false, message: 'Invalid JSON payload.' }, 400);
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return jsonResponse({ accepted: false, message: 'The JSON body must be an object.' }, 400);
  if (typeof payload.device_id === 'string' && payload.device_id !== deviceCode) return jsonResponse({ accepted: false, message: 'Payload device_id does not match the request header.' }, 400);

  const { data: device, error: deviceError } = await supabase
    .from('telemetry_devices')
    .select('id, device_code, status, credential_hash, machine_id, reported_machine_serial')
    .eq('device_code', deviceCode)
    .maybeSingle();

  if (deviceError) return jsonResponse({ accepted: false, message: 'Telemetry service is temporarily unavailable.' }, 503);
  if (!device || device.status !== 'active') return jsonResponse({ accepted: false, message: 'Unknown or inactive telemetry device.' }, 401);
  if (!constantTimeEqual(await sha256Hex(deviceKey), device.credential_hash)) return jsonResponse({ accepted: false, message: 'Invalid telemetry device credentials.' }, 401);

  let machineLink: unknown = null;
  const machineSerial = typeof payload.machine_serial === 'string' ? payload.machine_serial.trim().slice(0, 160) : '';
  if (machineSerial && !device.machine_id && normalizedSerial(machineSerial) !== normalizedSerial(device.reported_machine_serial)) {
    const { data: linkResult, error: linkError } = await supabase.rpc('try_auto_link_telemetry_device', {
      p_device_id: device.id,
      p_machine_serial: machineSerial,
    });
    if (!linkError) machineLink = linkResult;
  }

  let locationResult: unknown = null;
  const rawLocation = payload.location;
  if (rawLocation && typeof rawLocation === 'object' && !Array.isArray(rawLocation)) {
    const location = rawLocation as Record<string, unknown>;
    const latitude = numberOrNull(location.latitude ?? location.lat);
    const longitude = numberOrNull(location.longitude ?? location.lng ?? location.lon);

    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return jsonResponse({ accepted: false, message: 'Invalid location coordinates.' }, 400);
    }

    const source = typeof location.source === 'string' ? location.source.trim().toLowerCase().slice(0, 20) : 'gnss';
    const { data: recordedLocation, error: locationError } = await supabase.rpc('record_telemetry_device_location', {
      p_device_id: device.id,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: numberOrNull(location.accuracy_m ?? location.accuracy),
      p_altitude_m: numberOrNull(location.altitude_m ?? location.altitude),
      p_speed_mps: numberOrNull(location.speed_mps ?? location.speed),
      p_satellites: intOrNull(location.satellites),
      p_hdop: numberOrNull(location.hdop),
      p_source: source,
      p_fix_at: validDateOrNull(location.fix_at ?? location.timestamp),
    });

    if (locationError) {
      const status = locationError.code === '42501' ? 403 : locationError.code === '22023' ? 400 : 500;
      return jsonResponse({ accepted: false, message: status === 500 ? 'Location ingestion failed.' : locationError.message }, status);
    }
    locationResult = recordedLocation;
  }

  const isSimulation = payload.simulation === true || payload.type === 'simulation_snapshot';
  let result: unknown;
  let ingestError: { code?: string; message: string } | null = null;

  if (payload.type === 'location_update') {
    if (!locationResult) return jsonResponse({ accepted: false, message: 'location_update requires a location object.' }, 400);
    result = { accepted: true, location_update: true };
  } else if (payload.type === 'simulation_snapshot') {
    const response = await supabase.rpc('ingest_telemetry_simulation_snapshot', {
      p_device_id: device.id,
      p_payload: payload,
    });
    result = response.data;
    ingestError = response.error;
  } else {
    const response = await supabase.rpc('ingest_telemetry_payload_v3', {
      p_device_id: device.id,
      p_payload: payload,
    });
    result = response.data;
    ingestError = response.error;
  }

  if (ingestError) {
    const status = ingestError.code === '42501' ? 403 : ingestError.code === '22023' ? 400 : 500;
    return jsonResponse({ accepted: false, message: status === 500 ? 'Telemetry ingestion failed.' : ingestError.message }, status);
  }

  const transport = payload.transport === 'wifi' || payload.transport === 'cellular' ? String(payload.transport) : null;
  const patch: Record<string, unknown> = {};
  if (transport) patch.last_transport = transport;
  const wifiRssi = intOrNull(payload.wifi_rssi);
  if (wifiRssi !== null) patch.wifi_rssi = wifiRssi;
  const cellularCsq = intOrNull(payload.cellular_csq ?? payload.cell_csq);
  if (cellularCsq !== null) patch.cellular_csq = cellularCsq;
  if (typeof payload.cellular_operator === 'string') patch.cellular_operator = String(payload.cellular_operator).slice(0, 120);
  if (typeof payload.cellular_model === 'string') patch.cellular_model = String(payload.cellular_model).slice(0, 120);
  if (Object.keys(patch).length > 0) await supabase.from('telemetry_devices').update(patch).eq('id', device.id);

  if (!isSimulation && payload.type !== 'location_update') {
    await supabase
      .from('telemetry_machine_state')
      .update({ simulation_mode: false, simulated_counters: [] })
      .eq('device_id', device.id);
  }

  const responseBody = (result && typeof result === 'object' && !Array.isArray(result))
    ? { ...(result as Record<string, unknown>), machine_link: machineLink, location: locationResult }
    : { accepted: true, result, machine_link: machineLink, location: locationResult };

  return jsonResponse(responseBody);
});
