'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type TelemetryMode = 'live' | 'daily' | 'monthly';
type TransportPreference = 'auto' | 'wifi' | 'cellular';

type DeviceState = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  branch: string;
  profile_id: string | null;
  device_status: string;
  telemetry_mode: TelemetryMode;
  machine_status: string;
  active_fault_count: number;
  transport_preference: TransportPreference;
  last_transport: 'wifi' | 'cellular' | null;
  wifi_enabled: boolean;
  cellular_enabled: boolean;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  cellular_model: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_counter_at: string | null;
  last_heartbeat_at: string | null;
  last_config_at: string | null;
};

type ActiveFault = {
  id: string;
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  fault_code: string;
  severity: string;
  detail: string | null;
  started_at: string;
  last_seen_at: string;
};

type TelemetryDashboardPayload = {
  device_states?: DeviceState[];
  active_faults?: ActiveFault[];
};

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function online(lastSeen: string | null) {
  return Boolean(lastSeen && Date.now() - new Date(lastSeen).getTime() <= 30 * 60 * 1000);
}

function machineLabel(row: DeviceState) {
  if (!row.machine_id) return 'Unassigned';
  return row.machine_name ?? row.serial_number ?? row.machine_id;
}

function connectionDetail(row: DeviceState) {
  if (row.last_transport === 'wifi') {
    return row.wifi_rssi === null ? 'Wi-Fi' : `Wi-Fi ${row.wifi_rssi} dBm`;
  }
  if (row.last_transport === 'cellular') {
    const parts = ['SIM'];
    if (row.cellular_operator) parts.push(row.cellular_operator);
    if (row.cellular_csq !== null) parts.push(`CSQ ${row.cellular_csq}`);
    return parts.join(' · ');
  }
  return 'No successful transport yet';
}

export function TelemetryLiveControl() {
  const { userDetails } = useAuth();
  const [devices, setDevices] = useState<DeviceState[]>([]);
  const [faults, setFaults] = useState<ActiveFault[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDevice, setSavingDevice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canControl = ['admin', 'operations'].includes(userDetails?.role ?? '');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().rpc('get_telemetry_dashboard', {
      p_period: 'today',
      p_branch: 'all',
    });
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const payload = (data ?? {}) as TelemetryDashboardPayload;
    setDevices(payload.device_states ?? []);
    setFaults(payload.active_faults ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load live telemetry state.');
      setLoading(false);
    });
  }, [load]);

  async function updateControl(
    row: DeviceState,
    changes: {
      mode?: TelemetryMode;
      transport?: TransportPreference;
      wifiEnabled?: boolean;
      cellularEnabled?: boolean;
    },
  ) {
    setSavingDevice(row.device_id);
    setError(null);
    setMessage(null);

    const { error: updateError } = await getSupabaseClient().rpc('set_telemetry_device_control', {
      p_device_code: row.device_code,
      p_mode: changes.mode ?? null,
      p_transport_preference: changes.transport ?? null,
      p_wifi_enabled: changes.wifiEnabled ?? null,
      p_cellular_enabled: changes.cellularEnabled ?? null,
    });

    setSavingDevice(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage(`${row.device_code} remote control updated. The device will apply it on its next config sync.`);
    await load();
  }

  return (
    <section className="neo-card spatial-card">
      <div className="page-header">
        <div>
          <div className="badge">Live device control</div>
          <h2>Machine telemetry devices</h2>
          <p>
            Device state appears here even before the first sale. Live devices pull remote configuration every
            few minutes and can fail over between Wi-Fi and cellular.
          </p>
        </div>
        <button className="button secondary" disabled={loading} onClick={() => load()} type="button">
          Refresh
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      {loading && devices.length === 0 ? <HamsterLoader label="Loading live telemetry devices" /> : null}

      {!loading && devices.length === 0 ? <p>No active telemetry devices are registered.</p> : null}

      {devices.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Device</th>
                <th>Connection</th>
                <th>Machine state</th>
                <th>Mode</th>
                <th>Preferred network</th>
                <th>Networks enabled</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((row) => {
                const saving = savingDevice === row.device_id;
                return (
                  <tr key={row.device_id}>
                    <td>
                      <strong>{machineLabel(row)}</strong>
                      <div className="muted">{row.serial_number ?? row.branch ?? ''}</div>
                    </td>
                    <td>
                      {row.device_code}
                      <div className="muted">{row.firmware_version ?? 'Firmware not reported'}</div>
                    </td>
                    <td>
                      <StatusBadge
                        value={online(row.last_seen_at) ? 'online' : 'offline'}
                        tone={online(row.last_seen_at) ? 'success' : 'danger'}
                      />
                      <div className="muted">{connectionDetail(row)}</div>
                    </td>
                    <td>
                      <StatusBadge value={row.machine_status} />
                      <div className="muted">{row.active_fault_count} active fault(s)</div>
                    </td>
                    <td>
                      {canControl ? (
                        <select
                          aria-label={`Telemetry mode for ${row.device_code}`}
                          disabled={saving}
                          value={row.telemetry_mode}
                          onChange={(event) => updateControl(row, { mode: event.target.value as TelemetryMode })}
                        >
                          <option value="live">Live</option>
                          <option value="daily">Daily</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      ) : row.telemetry_mode}
                    </td>
                    <td>
                      {canControl ? (
                        <select
                          aria-label={`Network preference for ${row.device_code}`}
                          disabled={saving}
                          value={row.transport_preference}
                          onChange={(event) => updateControl(row, { transport: event.target.value as TransportPreference })}
                        >
                          <option value="auto">Auto: Wi-Fi then SIM</option>
                          <option value="wifi">Prefer Wi-Fi</option>
                          <option value="cellular">Prefer SIM</option>
                        </select>
                      ) : row.transport_preference}
                    </td>
                    <td>
                      {canControl ? (
                        <div className="grid">
                          <label>
                            <input
                              checked={row.wifi_enabled}
                              disabled={saving}
                              onChange={(event) => updateControl(row, { wifiEnabled: event.target.checked })}
                              type="checkbox"
                            />{' '}
                            Wi-Fi
                          </label>
                          <label>
                            <input
                              checked={row.cellular_enabled}
                              disabled={saving}
                              onChange={(event) => updateControl(row, { cellularEnabled: event.target.checked })}
                              type="checkbox"
                            />{' '}
                            SIM
                          </label>
                        </div>
                      ) : `${row.wifi_enabled ? 'Wi-Fi ' : ''}${row.cellular_enabled ? 'SIM' : ''}`}
                    </td>
                    <td>
                      {formatDate(row.last_seen_at)}
                      <div className="muted">Config: {formatDate(row.last_config_at)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {faults.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <h3>Active machine faults</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Fault</th>
                  <th>Severity</th>
                  <th>Detail</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {faults.map((fault) => (
                  <tr key={fault.id}>
                    <td>{fault.machine_name ?? fault.serial_number ?? fault.device_code}</td>
                    <td>{fault.fault_code}</td>
                    <td><StatusBadge value={fault.severity} /></td>
                    <td>{fault.detail ?? 'No detail reported'}</td>
                    <td>{formatDate(fault.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
