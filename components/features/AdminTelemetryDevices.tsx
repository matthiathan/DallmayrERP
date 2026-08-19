'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';

type DeviceStatus = 'active' | 'disabled';
type TelemetryMode = 'live' | 'daily' | 'monthly';
type TransportPreference = 'auto' | 'wifi' | 'cellular';

type TelemetryDevice = {
  id: string;
  device_code: string;
  machine_id: string | null;
  site_id: string | null;
  status: string;
  profile_id: string | null;
  location_override: string | null;
  firmware_version: string | null;
  wifi_rssi: number | null;
  last_seen_at: string | null;
  last_upload_at: string | null;
  last_sequence: number;
  updated_at: string;
  transport_preference: TransportPreference;
  wifi_enabled: boolean;
  cellular_enabled: boolean;
  last_transport: 'wifi' | 'cellular' | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  location_interval_minutes: number;
  location_min_move_m: number;
};

type MachineOption = {
  id: string;
  branch: string;
  site_id: string | null;
  serial_number: string | null;
  machine_name: string | null;
  model: string | null;
  customer_name: string | null;
  site_name: string | null;
  site_address: string | null;
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

function isOnline(value: string | null) {
  return Boolean(value && Date.now() - new Date(value).getTime() <= 30 * 60 * 1000);
}

function machineLabel(machine: MachineOption) {
  const name = machine.machine_name ?? machine.model ?? 'Unnamed machine';
  const serial = machine.serial_number ? ` · S/N ${machine.serial_number}` : '';
  const customer = machine.customer_name ? ` · ${machine.customer_name}` : '';
  const site = machine.site_name ? ` · ${machine.site_name}` : '';
  return `${name}${serial}${customer}${site}`;
}

export function AdminTelemetryDevices() {
  const [devices, setDevices] = useState<TelemetryDevice[]>([]);
  const [assignedMachines, setAssignedMachines] = useState<Record<string, MachineOption>>({});
  const [machineResults, setMachineResults] = useState<MachineOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('active');
  const [locationOverride, setLocationOverride] = useState('');
  const [machineSearch, setMachineSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [deviceModes, setDeviceModes] = useState<Record<string, TelemetryMode>>({});
  const [transportPreference, setTransportPreference] = useState<TransportPreference>('auto');
  const [wifiEnabled, setWifiEnabled] = useState(true);
  const [cellularEnabled, setCellularEnabled] = useState(true);
  const [reportingMode, setReportingMode] = useState<TelemetryMode>('live');
  const [locationInterval, setLocationInterval] = useState(15);
  const [movementThreshold, setMovementThreshold] = useState(50);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [networkFilter, setNetworkFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [page, setPage] = useState(1);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [{ data, error: loadError }, { data: overviewData }] = await Promise.all([
      client
        .from('telemetry_devices')
        .select('id,device_code,machine_id,site_id,status,profile_id,location_override,firmware_version,wifi_rssi,last_seen_at,last_upload_at,last_sequence,updated_at,transport_preference,wifi_enabled,cellular_enabled,last_transport,cellular_csq,cellular_operator,location_interval_minutes,location_min_move_m')
        .order('device_code'),
      client.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' }),
    ]);

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as TelemetryDevice[];
    setDevices(rows);
    const overview = (overviewData ?? {}) as { device_states?: Array<{ device_id: string; telemetry_mode?: TelemetryMode }> };
    setDeviceModes(Object.fromEntries((overview.device_states ?? []).map((row) => [row.device_id, row.telemetry_mode ?? 'live'])));
    setSelectedDeviceId((current) => current && rows.some((row) => row.id === current) ? current : null);

    const machineIds = Array.from(new Set(rows.map((row) => row.machine_id).filter((value): value is string => Boolean(value))));
    if (machineIds.length > 0) {
      const { data: machineData, error: machineError } = await client
        .from('machines')
        .select('id,branch,site_id,serial_number,machine_name,model')
        .in('id', machineIds);

      if (machineError) {
        setError(machineError.message);
      } else {
        const mapped = Object.fromEntries(((machineData ?? []) as MachineOption[]).map((machine) => [machine.id, machine]));
        setAssignedMachines(mapped);
      }
    } else {
      setAssignedMachines({});
    }

    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDevices().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry devices.');
      setLoading(false);
    });
  }, [loadDevices]);

  useEffect(() => {
    if (!selectedDevice) return;
    setSelectedMachineId(selectedDevice.machine_id ?? '');
    setDeviceStatus(selectedDevice.status === 'disabled' ? 'disabled' : 'active');
    setLocationOverride(selectedDevice.location_override ?? '');
    setTransportPreference(selectedDevice.transport_preference ?? 'auto');
    setWifiEnabled(selectedDevice.wifi_enabled ?? true);
    setCellularEnabled(selectedDevice.cellular_enabled ?? true);
    setReportingMode(deviceModes[selectedDevice.id] ?? 'live');
    setLocationInterval(selectedDevice.location_interval_minutes ?? 15);
    setMovementThreshold(selectedDevice.location_min_move_m ?? 50);
    setMachineSearch('');
    setMachineResults([]);
  }, [deviceModes, selectedDevice]);

  async function searchMachines(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    const { data, error: searchError } = await getSupabaseClient().rpc('search_machine_assets', {
      p_search: machineSearch.trim() || null,
      p_branch: 'all',
      p_status: 'active',
      p_unlinked: null,
      p_offset: 0,
      p_limit: 100,
    });
    setSearching(false);

    if (searchError) {
      setError(searchError.message);
      return;
    }
    setMachineResults((data ?? []) as MachineOption[]);
  }

  async function saveDevice() {
    if (!selectedDevice) return;
    const selectedMachine = machineResults.find((machine) => machine.id === selectedMachineId)
      ?? assignedMachines[selectedMachineId]
      ?? null;

    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: saveError } = await getSupabaseClient()
      .from('telemetry_devices')
      .update({
        machine_id: selectedMachineId || null,
        site_id: selectedMachine?.site_id ?? null,
        status: deviceStatus,
        location_override: locationOverride.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedDevice.id);
    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }

    const client = getSupabaseClient();
    const { error: controlError } = await client.rpc('set_telemetry_device_control', {
      p_device_code: selectedDevice.device_code,
      p_mode: reportingMode,
      p_transport_preference: transportPreference,
      p_wifi_enabled: wifiEnabled,
      p_cellular_enabled: cellularEnabled,
    });
    if (controlError) {
      setError(controlError.message);
      setSaving(false);
      return;
    }
    const { error: locationError } = await client.rpc('set_telemetry_device_location_control', {
      p_device_code: selectedDevice.device_code,
      p_location_enabled: true,
      p_location_interval_minutes: locationInterval,
      p_location_min_move_m: movementThreshold,
    });
    if (locationError) {
      setError(locationError.message);
      setSaving(false);
      return;
    }

    setMessage(`${selectedDevice.device_code} was updated successfully.`);
    await loadDevices();
    setSaving(false);
  }

  function manageDevice(device: TelemetryDevice) {
    setSelectedDeviceId(device.id);
    setMessage(null);
    setError(null);
  }

  const metrics = useMemo(() => ({
    total: devices.filter((device) => device.status === 'active').length,
    online: devices.filter((device) => device.status === 'active' && isOnline(device.last_seen_at)).length,
    offline: devices.filter((device) => device.status === 'active' && !isOnline(device.last_seen_at)).length,
    unassigned: devices.filter((device) => !device.machine_id).length,
    pending: devices.filter((device) => device.status === 'active' && (!device.last_seen_at || new Date(device.updated_at).getTime() > new Date(device.last_seen_at).getTime())).length,
  }), [devices]);

  const filteredDevices = useMemo(() => devices.filter((device) => {
    if (statusFilter === 'online' && !isOnline(device.last_seen_at)) return false;
    if (statusFilter === 'offline' && isOnline(device.last_seen_at)) return false;
    if (statusFilter === 'unassigned' && device.machine_id) return false;
    if (networkFilter !== 'all' && device.last_transport !== networkFilter) return false;
    if (modeFilter !== 'all' && deviceModes[device.id] !== modeFilter) return false;
    const term = deviceSearch.trim().toLowerCase();
    if (!term) return true;
    const machine = device.machine_id ? assignedMachines[device.machine_id] : null;
    return [device.device_code, device.firmware_version, device.profile_id, device.cellular_operator, machine ? machineLabel(machine) : 'unassigned'].join(' ').toLowerCase().includes(term);
  }), [assignedMachines, deviceModes, deviceSearch, devices, modeFilter, networkFilter, statusFilter]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filteredDevices.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleDevices = filteredDevices.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => { setPage(1); }, [deviceSearch, modeFilter, networkFilter, statusFilter]);

  const machineOptions = useMemo(() => {
    const current = selectedMachineId ? assignedMachines[selectedMachineId] : null;
    const options = current && !machineResults.some((machine) => machine.id === current.id)
      ? [current, ...machineResults]
      : machineResults;
    return options;
  }, [assignedMachines, machineResults, selectedMachineId]);

  return (
    <section className={`fleet-route-page device-management-workspace ${selectedDevice ? 'has-device-detail' : ''}`}>
      <div className="device-management-main">
        <header className="fleet-page-heading"><div><div className="device-heading-title"><h1>Telemetry devices</h1><span>Administrator only</span></div><p>Provision, assign and remotely configure fleet controllers.</p></div><button className="fleet-button secondary" disabled={loading} onClick={() => loadDevices()} type="button"><NavigationIcon kind="telemetry" />Refresh</button></header>

        {error ? <div className="fleet-banner is-error" role="alert"><strong>Device update failed.</strong><span>{error}</span></div> : null}
        {message ? <div className="fleet-banner is-success" role="status"><strong>Configuration saved.</strong><span>{message}</span></div> : null}

        <section className="fleet-metric-grid device-metric-grid">
          <article className="fleet-metric-card"><span className="fleet-metric-icon is-blue"><NavigationIcon kind="settings" /></span><div><span>Active devices</span><strong>{metrics.total.toLocaleString('en-ZA')}</strong></div><small>Provisioned fleet controllers</small></article>
          <article className="fleet-metric-card"><span className="fleet-metric-icon is-amber"><NavigationIcon kind="users" /></span><div><span>Unassigned</span><strong>{metrics.unassigned.toLocaleString('en-ZA')}</strong></div><small>Needs a machine assignment</small></article>
          <article className="fleet-metric-card"><span className="fleet-metric-icon is-green"><NavigationIcon kind="telemetry" /></span><div><span>Online</span><strong>{metrics.online.toLocaleString('en-ZA')}</strong></div><small>Seen within 30 minutes</small></article>
          <article className="fleet-metric-card"><span className="fleet-metric-icon is-grey"><NavigationIcon kind="telemetry" /></span><div><span>Offline</span><strong>{metrics.offline.toLocaleString('en-ZA')}</strong></div><small>No recent heartbeat</small></article>
          <article className="fleet-metric-card"><span className="fleet-metric-icon is-red"><NavigationIcon kind="queue" /></span><div><span>Updates pending</span><strong>{metrics.pending.toLocaleString('en-ZA')}</strong></div><small>Awaiting device sync</small></article>
        </section>

        <section className="fleet-panel device-register-panel">
          <div className="fleet-filters device-register-filters"><label className="fleet-search"><NavigationIcon kind="search" /><input aria-label="Search telemetry devices" placeholder="Search devices or assigned machines" value={deviceSearch} onChange={(event) => setDeviceSearch(event.target.value)} /></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All</option><option value="online">Online</option><option value="offline">Offline</option><option value="unassigned">Unassigned</option></select></label><label><span>Network</span><select value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value)}><option value="all">All</option><option value="wifi">Wi-Fi</option><option value="cellular">Cellular</option></select></label><label><span>Reporting mode</span><select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}><option value="all">All</option><option value="live">Live</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select></label><button className="fleet-button secondary" onClick={() => { setDeviceSearch(''); setStatusFilter('all'); setNetworkFilter('all'); setModeFilter('all'); }} type="button">Clear filters</button></div>

          {loading && devices.length === 0 ? <HamsterLoader label="Loading telemetry devices" /> : <div className="fleet-table-scroll"><table className="fleet-machine-table device-register-table"><thead><tr><th>Device ID</th><th>Assigned machine</th><th>Protocol</th><th>Firmware</th><th>Network</th><th>Signal</th><th>Reporting mode</th><th>Last config sync</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleDevices.map((device) => { const machine = device.machine_id ? assignedMachines[device.machine_id] : null; const online = isOnline(device.last_seen_at); return <tr className={selectedDeviceId === device.id ? 'is-selected' : undefined} key={device.id}><td><button className="fleet-machine-link" onClick={() => manageDevice(device)} type="button"><strong>{device.device_code}</strong></button></td><td><strong>{machine ? (machine.machine_name ?? machine.model ?? machine.serial_number ?? device.machine_id) : 'Unassigned'}</strong><span>{machine?.serial_number ?? 'No machine linked'}</span></td><td>{device.profile_id ?? 'MDB'}</td><td>{device.firmware_version ?? 'Unknown'}</td><td><strong>{device.last_transport === 'cellular' ? 'Cellular' : device.last_transport === 'wifi' ? 'Wi-Fi' : 'Not reported'}</strong><span>{device.cellular_operator ?? ''}</span></td><td><span className={`device-signal is-${online ? 'good' : 'offline'}`} aria-label={device.wifi_rssi === null ? 'Signal not reported' : `${device.wifi_rssi} dBm`}><i /><i /><i /><i /></span></td><td><span className="fleet-mode-label">{deviceModes[device.id] ?? 'live'}</span></td><td><strong>{formatDate(device.last_seen_at)}</strong></td><td><span className={`fleet-status-pill ${online ? 'is-success' : 'is-neutral'}`}><i />{online ? 'Online' : 'Offline'}</span></td><td><button aria-label={`Manage ${device.device_code}`} className="fleet-row-action" onClick={() => manageDevice(device)} type="button">•••</button></td></tr>; })}</tbody></table></div>}
          <footer className="fleet-table-footer"><div className="fleet-table-footer-copy"><strong>Showing {filteredDevices.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filteredDevices.length)} of {filteredDevices.length.toLocaleString('en-ZA')}</strong><span>Last refreshed {lastUpdated ? formatDate(lastUpdated.toISOString()) : 'never'}</span></div><div className="fleet-table-pagination"><button disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button><span>Page {currentPage} of {pageCount}</span><button disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next</button></div></footer>
        </section>
      </div>

      {selectedDevice ? <aside className="device-detail-panel" aria-label={`${selectedDevice.device_code} configuration`}>
        <header><div><h2>{selectedDevice.device_code}</h2><strong>{selectedDevice.machine_id && assignedMachines[selectedDevice.machine_id] ? machineLabel(assignedMachines[selectedDevice.machine_id]) : 'Unassigned device'}</strong><span><i />Last contact: {formatDate(selectedDevice.last_seen_at)}</span></div><button aria-label="Close device configuration" onClick={() => setSelectedDeviceId(null)} type="button">×</button></header>

        <section><h3>Assignment</h3><form className="device-assignment-search" onSubmit={searchMachines}><input value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} placeholder="Find machine by name, serial or site" type="search" /><button disabled={searching} type="submit">{searching ? 'Searching…' : 'Find'}</button></form><label><span>Assigned machine</span><select value={selectedMachineId} onChange={(event) => setSelectedMachineId(event.target.value)}><option value="">Unassigned</option>{machineOptions.map((machine) => <option key={machine.id} value={machine.id}>{machineLabel(machine)}</option>)}</select></label><label><span>Device status</span><select value={deviceStatus} onChange={(event) => setDeviceStatus(event.target.value as DeviceStatus)}><option value="active">Active</option><option value="disabled">Disabled</option></select></label></section>

        <section><h3>Transport preference</h3><div className="device-radio-row">{(['auto','wifi','cellular'] as TransportPreference[]).map((value) => <label key={value}><input checked={transportPreference === value} onChange={() => setTransportPreference(value)} type="radio" /><span>{value === 'wifi' ? 'Wi-Fi' : value.charAt(0).toUpperCase() + value.slice(1)}</span></label>)}</div><label className="device-toggle-row"><span>Wi-Fi</span><input checked={wifiEnabled} onChange={(event) => setWifiEnabled(event.target.checked)} type="checkbox" /></label><label className="device-toggle-row"><span>Cellular</span><input checked={cellularEnabled} onChange={(event) => setCellularEnabled(event.target.checked)} type="checkbox" /></label></section>

        <section><h3>Reporting</h3><label><span>Reporting mode</span><select value={reportingMode} onChange={(event) => setReportingMode(event.target.value as TelemetryMode)}><option value="live">Live</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select></label><label><span>Location update interval</span><select value={locationInterval} onChange={(event) => setLocationInterval(Number(event.target.value))}><option value={1}>1 minute</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={1440}>Daily</option></select></label><label><span>Movement threshold</span><select value={movementThreshold} onChange={(event) => setMovementThreshold(Number(event.target.value))}><option value={25}>±25 m</option><option value={50}>±50 m</option><option value={100}>±100 m</option><option value={250}>±250 m</option><option value={500}>±500 m</option></select></label></section>

        <section><h3>Device information</h3><dl><div><dt>Firmware</dt><dd>{selectedDevice.firmware_version ?? 'Not reported'}</dd></div><div><dt>Network</dt><dd>{selectedDevice.last_transport ?? 'Not reported'}</dd></div><div><dt>Signal</dt><dd>{selectedDevice.wifi_rssi !== null ? `${selectedDevice.wifi_rssi} dBm` : selectedDevice.cellular_csq !== null ? `CSQ ${selectedDevice.cellular_csq}` : 'Not reported'}</dd></div><div><dt>Last upload</dt><dd>{formatDate(selectedDevice.last_upload_at)}</dd></div><div><dt>Sequence</dt><dd>{selectedDevice.last_sequence.toLocaleString('en-ZA')}</dd></div></dl></section>

        <section><h3>Location override</h3><label><span>Optional location text</span><input value={locationOverride} onChange={(event) => setLocationOverride(event.target.value)} placeholder="Use the machine site by default" /></label></section>
        <footer><button className="fleet-button" disabled={saving} onClick={saveDevice} type="button">{saving ? 'Sending configuration…' : 'Save and send configuration'}</button></footer>
      </aside> : null}
    </section>
  );
}
