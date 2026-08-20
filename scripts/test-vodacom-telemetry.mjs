const endpoint = process.env.TELEMETRY_TEST_ENDPOINT?.trim()
  || 'https://egbiiizxsqlarqpnzxxs.supabase.co/functions/v1/telemetry-ingest';
const deviceId = process.env.TELEMETRY_TEST_DEVICE_ID?.trim() || '';
const deviceKey = process.env.TELEMETRY_TEST_DEVICE_KEY || '';
const anonKey = process.env.TELEMETRY_TEST_ANON_KEY?.trim()
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  || '';
const requestedTransport = process.env.TELEMETRY_TEST_TRANSPORT?.trim().toLowerCase() || 'unknown';
const cellularConfirmed = process.env.TELEMETRY_TEST_CELLULAR_CONFIRMED === 'true';

if (!deviceId || !deviceKey || !anonKey) {
  throw new Error('Set TELEMETRY_TEST_DEVICE_ID, TELEMETRY_TEST_DEVICE_KEY and TELEMETRY_TEST_ANON_KEY before running the Vodacom telemetry test.');
}
if (!/^https:\/\//i.test(endpoint)) throw new Error('TELEMETRY_TEST_ENDPOINT must use HTTPS.');
if (!['unknown', 'wifi', 'cellular'].includes(requestedTransport)) {
  throw new Error('TELEMETRY_TEST_TRANSPORT must be unknown, wifi or cellular.');
}
if (requestedTransport === 'cellular' && !cellularConfirmed) {
  throw new Error('Set TELEMETRY_TEST_CELLULAR_CONFIRMED=true only after Wi-Fi is disabled and the request is definitely using Vodacom data.');
}

const transport = requestedTransport === 'unknown' ? undefined : requestedTransport;
const bootId = `VODACOM-TEST-${Date.now()}`;
let sequence = 1;
let requestBytes = 0;
let responseBytes = 0;

async function sendSnapshot(soldTotal, revenueCentsTotal) {
  const payload = {
    type: 'simulation_snapshot',
    device_id: deviceId,
    boot_id: bootId,
    sequence,
    firmware: 'vodacom-test-environment-1.0',
    ...(transport ? { transport } : {}),
    ...(transport === 'cellular' ? { cellular_operator: 'Vodacom ZA' } : {}),
    items: [{
      selection: 'VODACOM-TEST-A1',
      product: 'Vodacom data test item',
      sold_total: soldTotal,
      failed_total: 0,
      revenue_cents_total: revenueCentsTotal,
    }],
  };
  sequence += 1;

  const body = JSON.stringify(payload);
  requestBytes += Buffer.byteLength(body);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'x-device-id': deviceId,
      'x-device-key': deviceKey,
      'x-firmware-version': 'vodacom-test-environment-1.0',
    },
    body,
  });
  const responseText = await response.text();
  responseBytes += Buffer.byteLength(responseText);

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(`Telemetry endpoint returned non-JSON data (HTTP ${response.status}).`);
  }

  if (!response.ok || result.accepted !== true || result.simulation !== true) {
    throw new Error(`Telemetry test failed (HTTP ${response.status}): ${JSON.stringify(result)}`);
  }
  return result;
}

console.log(`Testing ${deviceId} against ${endpoint}`);
console.log(transport === 'cellular'
  ? 'Vodacom cellular transport has been explicitly confirmed.'
  : 'This is a server/credential test only; cellular transport has not been claimed.');

const baseline = await sendSnapshot(0, 0);
const increment = await sendSnapshot(1, 1500);

if (Number(increment.daily_delta_units) !== 1 || Number(increment.daily_delta_revenue_cents) !== 1500) {
  throw new Error(`The endpoint accepted both uploads but did not calculate the expected safe simulation delta: ${JSON.stringify(increment)}`);
}

console.log(JSON.stringify({
  passed: true,
  transport: transport ?? 'unconfirmed',
  baseline_accepted: baseline.accepted,
  increment_accepted: increment.accepted,
  simulated_units: increment.daily_delta_units,
  simulated_revenue_cents: increment.daily_delta_revenue_cents,
  application_request_bytes: requestBytes,
  application_response_bytes: responseBytes,
  application_bytes_total: requestBytes + responseBytes,
  server_usage_record: increment.data_usage ?? null,
}, null, 2));

console.log('Application bytes are an exact minimum. Carrier usage also includes HTTP/TLS and mobile-network overhead; use modem counters or Vodacom billing for the actual total.');
