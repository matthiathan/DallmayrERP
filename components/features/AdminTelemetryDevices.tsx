'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type DeviceStatus = 'active' | 'disabled';

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

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const { data, error: loadError } = await client
      .from('telemetry_devices')
      .select('id,device_code,machine_id,site_id,status,profile_id,location_override,firmware_version,wifi_rssi,last_seen_at,last_upload_at,last_sequence,updated_at')
      .order('device_code');

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as TelemetryDevice[];
    setDevices(rows);
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
    setMachineSearch('');
    setMachineResults([]);
  }, [selectedDevice]);

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
    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setMessage(`${selectedDevice.device_code} was updated successfully.`);
    await loadDevices();
  }

  function manageDevice(device: TelemetryDevice) {
    setSelectedDeviceId(device.id);
    setMessage(null);
    setError(null);
  }

  const columns = useMemo<EnterpriseColumn<TelemetryDevice>[]>(() => [
    { id: 'device_code', header: 'Device', value: (row) => row.device_code, sortable: true, filterable: true, defaultWidth: 190, mobileTitle: true },
    {
      id: 'machine',
      header: 'Assigned machine',
      value: (row) => row.machine_id ? machineLabel(assignedMachines[row.machine_id] ?? { id: row.machine_id, branch: '', site_id: null, serial_number: null, machine_name: row.machine_id, model: null, customer_name: null, site_name: null, site_address: null }) : 'Unassigned',
      sortable: true,
      filterable: true,
      defaultWidth: 300,
      mobilePriority: 1,
    },
    { id: 'status', header: 'Status', value: (row) => row.status, render: (row) => <StatusBadge value={row.status} />, sortable: true, defaultWidth: 110, mobilePriority: 1 },
    {
      id: 'connection',
      header: 'Connection',
      value: (row) => isOnline(row.last_seen_at) ? 'online' : 'offline',
      render: (row) => <StatusBadge value={isOnline(row.last_seen_at) ? 'online' : 'offline'} tone={isOnline(row.last_seen_at) ? 'success' : 'danger'} />,
      sortable: true,
      defaultWidth: 120,
      mobilePriority: 2,
    },
    { id: 'firmware_version', header: 'Firmware', value: (row) => row.firmware_version ?? 'Unknown', sortable: true, filterable: true, defaultWidth: 190, mobileHidden: true },
    { id: 'wifi_rssi', header: 'Wi-Fi RSSI', value: (row) => row.wifi_rssi ?? -999, render: (row) => row.wifi_rssi === null ? 'Unknown' : `${row.wifi_rssi} dBm`, sortable: true, defaultWidth: 115, mobileHidden: true },
    { id: 'last_seen_at', header: 'Last seen', value: (row) => row.last_seen_at ?? '', render: (row) => formatDate(row.last_seen_at), sortable: true, defaultWidth: 175, mobilePriority: 3 },
    { id: 'last_sequence', header: 'Sequence', value: (row) => Number(row.last_sequence), sortable: true, defaultWidth: 100, mobileHidden: true },
    { id: 'manage', header: 'Manage', value: (row) => row.id, render: (row) => <button className="button secondary" onClick={() => manageDevice(row)} type="button">Manage</button>, filterable: false, defaultWidth: 120, mobilePriority: 1 },
  ], [assignedMachines]);

  const metrics = useMemo(() => ({
    total: devices.length,
    online: devices.filter((device) => device.status === 'active' && isOnline(device.last_seen_at)).length,
    offline: devices.filter((device) => device.status === 'active' && !isOnline(device.last_seen_at)).length,
    unassigned: devices.filter((device) => !device.machine_id).length,
  }), [devices]);

  const machineOptions = useMemo(() => {
    const current = selectedMachineId ? assignedMachines[selectedMachineId] : null;
    const options = current && !machineResults.some((machine) => machine.id === current.id)
      ? [current, ...machineResults]
      : machineResults;
    return options;
  }, [assignedMachines, machineResults, selectedMachineId]);

  return (
    <div className="grid spatial-stage">
      <PageToolbar
        title="Telemetry devices"
        description="Assign telemetry devices to machines and control their ingestion status."
        lastUpdated={lastUpdated}
        actions={<button className="button secondary" disabled={loading} onClick={() => loadDevices()} type="button">Refresh</button>}
      />

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="grid grid-3 spatial-kpi-grid">
        <KpiCard label="Registered devices" value={metrics.total} />
        <KpiCard label="Online" value={metrics.online} helper="Seen within 30 minutes" />
        <KpiCard label="Offline" value={metrics.offline} helper="Active devices without a recent heartbeat" />
        <KpiCard label="Unassigned" value={metrics.unassigned} helper="Must be linked to a machine" />
      </div>

      {loading && devices.length === 0 ? <div className="neo-card spatial-card"><HamsterLoader label="Loading telemetry devices" /></div> : (
        <div className="neo-card spatial-card">
          <h2>Device register</h2>
          <EnterpriseDataTable
            rows={devices}
            columns={columns}
            rowKey={(row) => row.id}
            searchPlaceholder="Search device, machine, firmware or status"
            emptyMessage="No telemetry devices have been registered."
            defaultPageSize={50}
            pageSizeOptions={[25, 50, 100, 250]}
            tableId="telemetry-devices"
          />
        </div>
      )}

      {selectedDevice ? (
        <div className="neo-card spatial-card">
          <div className="page-header">
            <div>
              <div className="badge">Administrator configuration</div>
              <h2>{selectedDevice.device_code}</h2>
              <p>Assign this device to an existing machine. The machine record supplies the serial number, customer, site and location used in reporting.</p>
            </div>
          </div>

          <form className="form-grid" onSubmit={searchMachines}>
            <label>
              <span>Find machine</span>
              <input value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} placeholder="Machine name, S/N, model, customer or site" type="search" />
            </label>
            <div className="action-row">
              <button className="button secondary" disabled={searching} type="submit">{searching ? 'Searching...' : 'Search machines'}</button>
            </div>
          </form>

          <div className="form-grid" style={{ marginTop: 16 }}>
            <label>
              <span>Assigned machine</span>
              <select value={selectedMachineId} onChange={(event) => setSelectedMachineId(event.target.value)}>
                <option value="">Unassigned</option>
                {machineOptions.map((machine) => <option key={machine.id} value={machine.id}>{machineLabel(machine)}</option>)}
              </select>
            </label>
            <label>
              <span>Device status</span>
              <select value={deviceStatus} onChange={(event) => setDeviceStatus(event.target.value as DeviceStatus)}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label>
              <span>Location override</span>
              <input value={locationOverride} onChange={(event) => setLocationOverride(event.target.value)} placeholder="Optional location text" />
            </label>
          </div>

          <div className="action-row" style={{ marginTop: 16 }}>
            <button className="button" disabled={saving} onClick={saveDevice} type="button">{saving ? 'Saving...' : 'Save assignment'}</button>
            <button className="button secondary" onClick={() => setSelectedDeviceId(null)} type="button">Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
