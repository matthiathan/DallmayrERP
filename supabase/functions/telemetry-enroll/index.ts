import { createClient } from 'npm:@supabase/supabase-js@2.112.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_BODY_BYTES = 2048;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Missing Supabase Edge Function environment variables.');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
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

function randomSecret(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return btoa(String.fromCharCode(...buffer)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ accepted: false, message: 'POST is required.' }, 405);

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return jsonResponse({ accepted: false, message: 'Payload is too large.' }, 413);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return jsonResponse({ accepted: false, message: 'Invalid JSON payload.' }, 400);
  }

  const enrollmentToken = String(payload.enrollment_token ?? '').trim();
  const hardwareUid = String(payload.hardware_uid ?? '').trim().toUpperCase();
  const machineSerial = String(payload.machine_serial ?? '').trim();
  const firmware = String(payload.firmware ?? '').trim();

  if (!enrollmentToken || !/^[0-9A-F]{12}$/.test(hardwareUid)) {
    return jsonResponse({ accepted: false, message: 'Enrollment token and valid ESP32 hardware UID are required.' }, 400);
  }

  const deviceKey = randomSecret(32);
  const { data, error } = await supabase.rpc('enroll_telemetry_device', {
    p_token_hash: await sha256Hex(enrollmentToken),
    p_hardware_uid: hardwareUid,
    p_machine_serial: machineSerial || null,
    p_credential_hash: await sha256Hex(deviceKey),
    p_firmware: firmware || null,
  });

  if (error) {
    const status = error.code === '42501' ? 403 : error.code === '23505' ? 409 : error.code === '22023' ? 400 : 500;
    return jsonResponse({ accepted: false, message: status === 500 ? 'Telemetry enrollment failed.' : error.message }, status);
  }

  return jsonResponse({ ...data, device_key: deviceKey });
});
