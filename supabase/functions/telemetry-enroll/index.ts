import { createClient } from 'npm:@supabase/supabase-js@2.112.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_BODY_BYTES = 4096;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase Edge Function environment variables.');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomSecret(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return btoa(String.fromCharCode(...buffer))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ accepted: false, message: 'POST is required.' }, 405);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ accepted: false, message: 'Payload is too large.' }, 413);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return jsonResponse({ accepted: false, message: 'Invalid JSON payload.' }, 400);
  }

  const enrollmentToken = String(payload.enrollment_token ?? '').trim();
  const factoryBootstrapToken = String(payload.factory_bootstrap_token ?? '').trim();
  const hardwareUid = String(payload.hardware_uid ?? '').trim().toUpperCase();
  const machineSerial = String(payload.machine_serial ?? '').trim();
  const firmware = String(payload.firmware ?? '').trim();
  const modemImei = String(payload.modem_imei ?? '').trim();
  const simIccid = String(payload.sim_iccid ?? '').trim();
  const cellularOperator = String(payload.cellular_operator ?? '').trim();
  const cellularModel = String(payload.cellular_model ?? '').trim();
  const location = payload.location && typeof payload.location === 'object'
    ? payload.location as Record<string, unknown>
    : null;

  if (!/^[0-9A-F]{12}$/.test(hardwareUid)) {
    return jsonResponse({ accepted: false, message: 'A valid ESP32 hardware UID is required.' }, 400);
  }
  if (modemImei && !/^\d{14,17}$/.test(modemImei)) {
    return jsonResponse({ accepted: false, message: 'Invalid modem IMEI.' }, 400);
  }
  if (simIccid && !/^\d{18,22}$/.test(simIccid)) {
    return jsonResponse({ accepted: false, message: 'Invalid SIM ICCID.' }, 400);
  }

  const deviceKey = randomSecret(32);
  const credentialHash = await sha256Hex(deviceKey);
  const enrollmentMethod = enrollmentToken
    ? 'one_time_token'
    : factoryBootstrapToken
      ? 'factory_zero_touch'
      : 'automatic_window';

  const enrollment = enrollmentToken
    ? await supabase.rpc('enroll_telemetry_device', {
        p_token_hash: await sha256Hex(enrollmentToken),
        p_hardware_uid: hardwareUid,
        p_machine_serial: machineSerial || null,
        p_credential_hash: credentialHash,
        p_firmware: firmware || null,
      })
    : factoryBootstrapToken
      ? await supabase.rpc('enroll_telemetry_device_factory', {
          p_hardware_uid: hardwareUid,
          p_bootstrap_token_hash: await sha256Hex(factoryBootstrapToken),
          p_machine_serial: machineSerial || null,
          p_credential_hash: credentialHash,
          p_firmware: firmware || null,
        })
      : await supabase.rpc('enroll_telemetry_device_zero_touch', {
          p_hardware_uid: hardwareUid,
          p_machine_serial: machineSerial || null,
          p_credential_hash: credentialHash,
          p_firmware: firmware || null,
        });

  if (enrollment.error) {
    const status = enrollment.error.code === '42501'
      ? 403
      : enrollment.error.code === '23505'
        ? 409
        : enrollment.error.code === '22023'
          ? 400
          : 500;
    return jsonResponse({
      accepted: false,
      message: status === 500 ? 'Telemetry enrollment failed.' : enrollment.error.message,
      enrollment_method: enrollmentMethod,
    }, status);
  }

  const result = enrollment.data && typeof enrollment.data === 'object'
    ? enrollment.data as Record<string, unknown>
    : {};
  const enrolledDeviceId = String(result.device_id ?? '').trim();

  if (enrolledDeviceId && (modemImei || simIccid || cellularOperator || cellularModel)) {
    const identityUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (modemImei) identityUpdate.modem_imei = modemImei;
    if (simIccid) identityUpdate.sim_iccid = simIccid;
    if (cellularOperator) identityUpdate.cellular_operator = cellularOperator.slice(0, 120);
    if (cellularModel) identityUpdate.cellular_model = cellularModel.slice(0, 120);
    await supabase.from('telemetry_devices').update(identityUpdate).eq('id', enrolledDeviceId);
  }

  let locationResult: unknown = null;
  if (enrolledDeviceId && location) {
    const latitude = finiteNumber(location.latitude);
    const longitude = finiteNumber(location.longitude);
    const accuracy = finiteNumber(location.accuracy_m);
    const source = String(location.source ?? 'cellular').trim().toLowerCase();
    if (latitude !== null && longitude !== null
        && latitude >= -90 && latitude <= 90
        && longitude >= -180 && longitude <= 180
        && ['cellular', 'wifi', 'gnss', 'manual', 'site', 'last_known'].includes(source)) {
      const recorded = await supabase.rpc('record_telemetry_device_location', {
        p_device_id: enrolledDeviceId,
        p_latitude: latitude,
        p_longitude: longitude,
        p_accuracy_m: accuracy,
        p_source: source,
      });
      if (!recorded.error) locationResult = recorded.data;
    }
  }

  return jsonResponse({
    ...result,
    accepted: true,
    enrollment_method: enrollmentMethod,
    device_key: deviceKey,
    first_location: locationResult,
  });
});
