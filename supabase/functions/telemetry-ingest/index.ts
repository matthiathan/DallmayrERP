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

function intOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function nonNegativeIntegerOrNull(value: unknown) {
  const parsed = intOrNull(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
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
    console.warn('[telemetry-ingest] reject_400 invalid_json', {
      device_code: deviceCode,
      firmware: request.headers.get('x-firmware-version') ?? 'unknown',
      request_bytes: new TextEncoder().encode(bodyText).byteLength,
    });
    return jsonResponse({ accepted: false, message: 'Invalid JSON payload.' }, 400);
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    console.warn('[telemetry-ingest] reject_400 body_not_object', {
      device_code: deviceCode,
      firmware: request.headers.get('x-firmware-version') ?? 'unknown',
    });
    return jsonResponse({ accepted: false, message: 'The JSON body must be an object.' }, 400);
  }
  if (typeof payload.device_id === 'string' && payload.device_id !== deviceCode) {
    console.warn('[telemetry-ingest] reject_400 device_id_mismatch', {
      device_code: deviceCode,
      payload_device_id: payload.device_id,
      firmware: request.headers.get('x-firmware-version') ?? 'unknown',
      payload_type: typeof payload.type === 'string' ? payload.type : 'unknown',
    });
    return jsonResponse({ accepted: false, message: 'Payload device_id does not match the request header.' }, 400);
  }

  const { data: device, error: deviceError } = await supabase
    .from('telemetry_devices')
    .select('id, device_code, status, credential_hash, machine_id, reported_machine_serial')
    .eq('device_code', deviceCode)
    .maybeSingle();

  if (deviceError) return jsonResponse({ accepted: false, message: 'Telemetry service is temporarily unavailable.' }, 503);
  if (!device || device.status !== 'active') return jsonResponse({ accepted: false, message: 'Unknown or inactive telemetry device.' }, 401);
  if (!constantTimeEqual(await sha256Hex(deviceKey), device.credential_hash)) return jsonResponse({ accepted: false, message: 'Invalid telemetry device credentials.' }, 401);

  // Remote Test Center log batches are isolated from production telemetry
  // ingestion. They are accepted only for an active, unexpired session owned by
  // this authenticated device and are capped to keep cellular use bounded.
  //
  // V6.8.41 field diagnostics showed the device entering the 1.5s debug upload
  // cadence while the server still routed the request through normal telemetry
  // ingestion. Recognize the explicit debug shape as well as the type marker so
  // field logs cannot be lost if an intermediary/serializer omits or alters the
  // top-level type value.
  const isDebugLogBatch = payload.type === 'debug_log_batch'
    || (
      typeof payload.test_session_id === 'string'
      && Array.isArray(payload.lines)
    );

  if (isDebugLogBatch) {
    const sessionId = typeof payload.test_session_id === 'string' ? payload.test_session_id.trim() : '';
    if (!sessionId) {
      console.warn('[telemetry-ingest] reject_400 missing_test_session_id', {
        device_code: deviceCode,
        firmware: request.headers.get('x-firmware-version') ?? 'unknown',
        payload_type: typeof payload.type === 'string' ? payload.type : 'unknown',
        lines_count: Array.isArray(payload.lines) ? payload.lines.length : -1,
      });
      return jsonResponse({ accepted: false, message: 'test_session_id is required.' }, 400);
    }

    const nowIso = new Date().toISOString();
    const { data: testSession, error: sessionError } = await supabase
      .from('telemetry_test_sessions')
      .select('id,device_id,status,expires_at')
      .eq('id', sessionId)
      .eq('device_id', device.id)
      .eq('status', 'active')
      .gt('expires_at', nowIso)
      .maybeSingle();

    if (sessionError) return jsonResponse({ accepted: false, message: 'Remote Test Center is temporarily unavailable.' }, 503);
    if (!testSession) return jsonResponse({ accepted: false, message: 'Remote Test Center session is not active.' }, 409);

    const bootId = typeof payload.boot_id === 'string' ? payload.boot_id.slice(0, 64) : '';
    const rawLines = Array.isArray(payload.lines) ? payload.lines.slice(0, 24) : [];
    const rows = rawLines.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const line = value as Record<string, unknown>;
      const message = typeof line.message === 'string'
        ? line.message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 500)
        : '';
      const sequence = nonNegativeIntegerOrNull(line.seq ?? line.sequence);
      if (!message.trim() || sequence === null) return [];
      return [{
        session_id: testSession.id,
        device_id: device.id,
        boot_id: bootId,
        device_sequence: sequence,
        device_uptime_ms: nonNegativeIntegerOrNull(line.uptime_ms),
        category: typeof line.category === 'string' ? line.category.slice(0, 40) : null,
        message,
      }];
    });

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from('telemetry_debug_logs')
        .upsert(rows, {
          onConflict: 'session_id,boot_id,device_sequence',
          ignoreDuplicates: true,
        });
      if (insertError) return jsonResponse({ accepted: false, message: 'Remote debug log storage failed.' }, 500);
    }

    const commandIds = Array.isArray(payload.completed_command_ids)
      ? payload.completed_command_ids
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 8)
      : [];
    if (commandIds.length > 0) {
      await supabase
        .from('telemetry_test_commands')
        .update({ status: 'completed', completed_at: nowIso })
        .eq('session_id', testSession.id)
        .eq('device_id', device.id)
        .eq('status', 'pending')
        .in('id', commandIds);
    }

    await supabase
      .from('telemetry_test_sessions')
      .update({
        acknowledged_at: nowIso,
        last_device_contact_at: nowIso,
        ...(rows.length > 0 ? { last_log_at: nowIso } : {}),
        updated_at: nowIso,
      })
      .eq('id', testSession.id);

    const transport = payload.transport === 'wifi' || payload.transport === 'cellular'
      ? String(payload.transport)
      : 'unknown';
    const usagePayload = payload.data_usage && typeof payload.data_usage === 'object' && !Array.isArray(payload.data_usage)
      ? payload.data_usage as Record<string, unknown>
      : {};
    const responseBody = {
      accepted: true,
      debug_log_batch: true,
      test_session_id: testSession.id,
      lines_recorded: rows.length,
      commands_completed: commandIds.length,
    };
    const responseBytes = new TextEncoder().encode(JSON.stringify(responseBody)).byteLength;
    await supabase.rpc('record_telemetry_data_usage', {
      p_device_id: device.id,
      p_transport: transport,
      p_request_bytes: new TextEncoder().encode(bodyText).byteLength,
      p_response_bytes: responseBytes,
      p_counter_epoch: typeof usagePayload.counter_epoch === 'string' ? usagePayload.counter_epoch.slice(0, 120) : null,
      p_application_tx_bytes_total: nonNegativeIntegerOrNull(usagePayload.application_tx_bytes_total),
      p_application_rx_bytes_total: nonNegativeIntegerOrNull(usagePayload.application_rx_bytes_total),
      p_modem_tx_bytes_total: nonNegativeIntegerOrNull(usagePayload.tx_bytes_total ?? usagePayload.modem_tx_bytes_total),
      p_modem_rx_bytes_total: nonNegativeIntegerOrNull(usagePayload.rx_bytes_total ?? usagePayload.modem_rx_bytes_total),
    });
    return jsonResponse(responseBody);
  }

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
  } else if (payload.type === 'config_ack') {
    const response = await supabase.rpc('record_telemetry_config_ack', {
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

  const usagePayload = payload.data_usage && typeof payload.data_usage === 'object' && !Array.isArray(payload.data_usage)
    ? payload.data_usage as Record<string, unknown>
    : {};
  const responseBytes = new TextEncoder().encode(JSON.stringify(responseBody)).byteLength;
  const { data: usageResult, error: usageError } = await supabase.rpc('record_telemetry_data_usage', {
    p_device_id: device.id,
    p_transport: transport ?? 'unknown',
    p_request_bytes: new TextEncoder().encode(bodyText).byteLength,
    p_response_bytes: responseBytes,
    p_counter_epoch: typeof usagePayload.counter_epoch === 'string' ? usagePayload.counter_epoch.slice(0, 120) : null,
    p_application_tx_bytes_total: nonNegativeIntegerOrNull(usagePayload.application_tx_bytes_total),
    p_application_rx_bytes_total: nonNegativeIntegerOrNull(usagePayload.application_rx_bytes_total),
    p_modem_tx_bytes_total: nonNegativeIntegerOrNull(usagePayload.tx_bytes_total ?? usagePayload.modem_tx_bytes_total),
    p_modem_rx_bytes_total: nonNegativeIntegerOrNull(usagePayload.rx_bytes_total ?? usagePayload.modem_rx_bytes_total),
  });

  let prepaidBalanceResult: unknown = null;
  let prepaidBalanceError: { message: string } | null = null;
  const prepaidPayload = payload.prepaid_balance;
  if (prepaidPayload && typeof prepaidPayload === 'object' && !Array.isArray(prepaidPayload)
      && (prepaidPayload as Record<string, unknown>).report_pending === true) {
    const prepaid = prepaidPayload as Record<string, unknown>;
    const status = typeof prepaid.status === 'string' ? prepaid.status.trim().toLowerCase() : 'failed';
    const remainingBytes = nonNegativeIntegerOrNull(prepaid.remaining_bytes);
    const response = await supabase.rpc('record_telemetry_prepaid_balance', {
      p_device_id: device.id,
      p_remaining_bytes: remainingBytes,
      p_balance_text: typeof prepaid.balance_text === 'string' ? prepaid.balance_text.slice(0, 1000) : null,
      p_query_status: status,
      p_error_text: typeof prepaid.error === 'string' ? prepaid.error.slice(0, 500) : null,
      // ESP32 uptime is not wall-clock time. The database uses receipt time when
      // the device cannot provide a valid ISO timestamp.
      p_checked_at: validDateOrNull(prepaid.checked_at),
    });
    prepaidBalanceResult = response.data;
    prepaidBalanceError = response.error;
  }

  return jsonResponse({
    ...responseBody,
    data_usage: usageError
      ? { recorded: false, message: 'Data-usage recording is temporarily unavailable.' }
      : usageResult,
    prepaid_balance: prepaidBalanceError
      ? { recorded: false, message: 'Prepaid-balance recording is temporarily unavailable.' }
      : prepaidBalanceResult,
  });
});
