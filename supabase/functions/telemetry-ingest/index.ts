import { createClient } from 'npm:@supabase/supabase-js@2.112.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_BODY_BYTES = 16 * 1024;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase Edge Function environment variables.');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-device-id, x-device-key, x-firmware-version',
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
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
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

  const deviceCode = (request.headers.get('x-device-id') ?? '').trim();
  const deviceKey = request.headers.get('x-device-key') ?? '';

  if (!deviceCode || !deviceKey) {
    return jsonResponse({ accepted: false, message: 'Device credentials are required.' }, 401);
  }

  let bodyText = '';
  try {
    bodyText = await request.text();
  } catch {
    return jsonResponse({ accepted: false, message: 'Could not read request body.' }, 400);
  }

  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ accepted: false, message: 'Payload is too large.' }, 413);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return jsonResponse({ accepted: false, message: 'Invalid JSON payload.' }, 400);
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return jsonResponse({ accepted: false, message: 'The JSON body must be an object.' }, 400);
  }

  if (typeof payload.device_id === 'string' && payload.device_id !== deviceCode) {
    return jsonResponse({ accepted: false, message: 'Payload device_id does not match the request header.' }, 400);
  }

  const { data: device, error: deviceError } = await supabase
    .from('telemetry_devices')
    .select('id, device_code, status, credential_hash')
    .eq('device_code', deviceCode)
    .maybeSingle();

  if (deviceError) {
    console.error('Telemetry device lookup failed:', deviceError.message);
    return jsonResponse({ accepted: false, message: 'Telemetry service is temporarily unavailable.' }, 503);
  }

  if (!device || device.status !== 'active') {
    return jsonResponse({ accepted: false, message: 'Unknown or inactive telemetry device.' }, 401);
  }

  const providedHash = await sha256Hex(deviceKey);
  if (!constantTimeEqual(providedHash, device.credential_hash)) {
    return jsonResponse({ accepted: false, message: 'Invalid telemetry device credentials.' }, 401);
  }

  const { data: result, error: ingestError } = await supabase.rpc(
    'ingest_telemetry_payload',
    {
      p_device_id: device.id,
      p_payload: payload,
    },
  );

  if (ingestError) {
    console.error('Telemetry ingestion failed:', ingestError.code, ingestError.message);

    const status = ingestError.code === '42501'
      ? 403
      : ingestError.code === '22023'
        ? 400
        : 500;

    return jsonResponse(
      {
        accepted: false,
        message: status === 500
          ? 'Telemetry ingestion failed.'
          : ingestError.message,
      },
      status,
    );
  }

  return jsonResponse(result ?? { accepted: true });
});
