'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

type DeviceRow = {
  id: string;
  device_code: string;
  machine_id: string | null;
  mdb_pin_swap: boolean;
  last_config_at: string | null;
  last_config_ack_at: string | null;
};

function syncLabel(device: DeviceRow | null) {
  if (!device?.last_config_at) return 'Not sent yet';
  if (!device.last_config_ack_at) return 'Awaiting device acknowledgement';
  return new Date(device.last_config_ack_at).getTime() >= new Date(device.last_config_at).getTime()
    ? 'Applied by device'
    : 'Awaiting device acknowledgement';
}

export function MdbPinOrderControl() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseClient()
      .from('telemetry_devices')
      .select('id,device_code,machine_id,mdb_pin_swap,last_config_at,last_config_ack_at')
      .eq('status', 'active')
      .order('device_code');
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const rows = (data ?? []) as DeviceRow[];
    setDevices(rows);
    setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? '');
  }, []);

  useEffect(() => {
    load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load MDB pin order.'));
  }, [load]);

  const selected = useMemo(() => devices.find((row) => row.id === selectedId) ?? null, [devices, selectedId]);

  async function setSwap(nextSwap: boolean) {
    if (!selected || saving || selected.mdb_pin_swap === nextSwap) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: saveError } = await getSupabaseClient()
      .from('telemetry_devices')
      .update({ mdb_pin_swap: nextSwap, updated_at: new Date().toISOString() })
      .eq('id', selected.id);
    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }
    setDevices((current) => current.map((row) => row.id === selected.id ? { ...row, mdb_pin_swap: nextSwap } : row));
    setMessage(`${selected.device_code}: ${nextSwap ? 'GPIO5 is now Master-TX and GPIO4 is Master-RX' : 'GPIO4 is now Master-TX and GPIO5 is Master-RX'}. The device will apply this at its next configuration sync.`);
    setSaving(false);
  }

  return (
    <section className="fleet-panel" data-mdb-pin-order-control="true">
      <div className="device-fleet-usage-heading">
        <div><span>MDB capture</span><h2>GPIO4 / GPIO5 logical pin order</h2></div>
        <small>{syncLabel(selected)}</small>
      </div>

      {error ? <div className="fleet-banner is-error" role="alert"><strong>MDB pin order update failed.</strong><span>{error}</span></div> : null}
      {message ? <div className="fleet-banner is-success" role="status"><strong>MDB pin order queued.</strong><span>{message}</span></div> : null}

      <div className="fleet-filters">
        <label>
          <span>Telemetry device</span>
          <select aria-label="MDB pin order telemetry device" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setMessage(null); setError(null); }}>
            {devices.length ? devices.map((device) => <option key={device.id} value={device.id}>{device.device_code}</option>) : <option value="">No active devices</option>}
          </select>
        </label>
        <label>
          <span>Logical pin order</span>
          <select
            aria-label="MDB logical pin order"
            disabled={!selected || saving}
            value={selected?.mdb_pin_swap ? 'swapped' : 'standard'}
            onChange={(event) => setSwap(event.target.value === 'swapped')}
          >
            <option value="standard">Standard · GPIO4 Master-TX / GPIO5 Master-RX</option>
            <option value="swapped">Swapped · GPIO5 Master-TX / GPIO4 Master-RX</option>
          </select>
        </label>
      </div>

      <p>
        This changes only which protected input is decoded as the MDB master transmit or receive path. GPIO4 and GPIO5 remain input-only; the telemetry controller does not drive the vending-machine MDB bus.
      </p>
    </section>
  );
}
