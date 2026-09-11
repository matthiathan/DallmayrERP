'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TelemetryEnrollmentWindowControl } from '@/components/features/TelemetryEnrollmentWindowControl';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { AccessibleDialog } from '@/components/ui/AccessibleDialog';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { SignalStrengthIndicator } from '@/components/ui/SignalStrengthIndicator';
import { getSupabaseClient } from '@/lib/supabase/client';
import { collectSupabasePagesResult } from '@/lib/supabase/collect-pages';
import { deviceConfigSyncState, deviceConnectionState } from '@/lib/telemetry/device-health';
import { DeviceRegisterPagination } from './DeviceRegisterPagination';
import { TelemetryConfigSyncPanel } from './TelemetryConfigSyncPanel';
import styles from './TelemetryDevicesWorkspace.module.css';

type TelemetryMode = 'live' | 'daily' | 'monthly';
type TransportPreference = 'auto' | 'wifi' | 'cellular';
type MdbPolarity = 'auto' | 'normal' | 'inverted';
type DeviceStatus = 'active' | 'disabled';

type Device = {
  id: string;
  device_code: string;
  hardware_uid: string | null;
  machine_id: string | null;
  site_id: string | null;
  profile_id: string | null;
  status: string;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_upload_at: string | null;
  last_counter_at: string | null;
  last_heartbeat_at: string | null;
  last_config_at: string | null;
  last_config_ack_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  transport_preference: TransportPreference;
  wifi_enabled: boolean;
  cellular_enabled: boolean;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  mdb_master_polarity: MdbPolarity;
  mdb_slave_polarity: MdbPolarity;
  mdb_pin_swap: boolean;
  location_override: string | null;
  location_interval_minutes: number;
  location_min_move_m: number;
  updated_at: string;
};

type Machine = {
  id: string;
  branch: string;
  site_id: string | null;
  serial_number: string | null;
  machine_name: string | null;
  model: string | null;
};

type Usage = {
  device_id: string;
  request_count: number;
  application_bytes: number;
  device_application_bytes: number;
  device_application_sample_count: number;
  measured_modem_bytes: number;
  modem_sample_count: number;
  projected_monthly_application_bytes: number;
  projected_monthly_device_application_bytes: number | null;
  projected_monthly_modem_bytes: number | null;
  last_reported_at: string | null;
};

type Prepaid = {
  device_id: string;
  carrier: string;
  remaining_bytes: number | null;
  query_status: string;
  alert_level: 'unknown' | 'stale' | 'failed' | 'unsupported' | 'parse_failed' | 'depleted' | 'critical' | 'low' | 'ok';
  request_pending: boolean;
  checked_at: string | null;
  warning_threshold_bytes: number;
  critical_threshold_bytes: number;
  check_interval_minutes: number;
};

const DEVICE_SELECT = 'id,device_code,hardware_uid,machine_id,site_id,profile_id,status,firmware_version,last_seen_at,last_upload_at,last_counter_at,last_heartbeat_at,last_config_at,last_config_ack_at,last_transport,transport_preference,wifi_enabled,cellular_enabled,wifi_rssi,cellular_csq,cellular_operator,mdb_master_polarity,mdb_slave_polarity,mdb_pin_swap,location_override,location_interval_minutes,location_min_move_m,updated_at';
const MACHINE_SELECT = 'id,branch,site_id,serial_number,machine_name,model';
const MACHINE_LOOKUP_BATCH_SIZE = 100;

function formatBytes(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const scaled = amount / (1024 ** index);
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never';
}

function age(value: string | null) {
  if (!value) return 'Never';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function actualUsage(usage: Usage | null | undefined) {
  if (!usage) return 0;
  if (Number(usage.modem_sample_count ?? 0) > 0) return Number(usage.measured_modem_bytes ?? 0);
  if (Number(usage.device_application_sample_count ?? 0) > 0) return Number(usage.device_application_bytes ?? 0);
  return Number(usage.application_bytes ?? 0);
}

function projectedUsage(usage: Usage | null | undefined) {
  if (!usage) return 0;
  if (Number(usage.modem_sample_count ?? 0) > 0) return Number(usage.projected_monthly_modem_bytes ?? 0);
  if (Number(usage.device_application_sample_count ?? 0) > 0) return Number(usage.projected_monthly_device_application_bytes ?? 0);
  return Number(usage.projected_monthly_application_bytes ?? 0);
}

function machineLabel(machine: Machine | null | undefined) {
  if (!machine) return 'Unassigned';
  const primary = machine.machine_name ?? machine.model ?? 'Unnamed machine';
  return `${primary}${machine.serial_number ? ` · ${machine.serial_number}` : ''}`;
}

function statusKey(device: Device) {
  return deviceConnectionState(device).key;
}

function transportLabel(transport: Device['last_transport']) {
  if (transport === 'wifi') return 'Wi-Fi';
  if (transport === 'cellular') return 'Cellular';
  return 'Not reported';
}

function transportDetail(device: Device) {
  if (device.last_transport === 'cellular') return device.cellular_operator ? `Operator ${device.cellular_operator}` : 'Carrier not reported';
  if (device.last_transport === 'wifi') return device.wifi_rssi === null ? 'Wi-Fi signal not reported' : `RSSI ${device.wifi_rssi} dBm`;
  return 'No recent network reported';
}

function usageDetail(usage: Usage | null | undefined, projection: number) {
  const source = !usage
    ? 'No usage samples received'
    : Number(usage.modem_sample_count ?? 0) > 0
      ? 'Modem bytes measured'
      : Number(usage.device_application_sample_count ?? 0) > 0
        ? 'Device application traffic'
        : 'Server-observed traffic';
  return `${source} · projects ${formatBytes(projection)}/month`;
}

function Stat({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail: string; tone?: 'neutral' | 'green' | 'red' | 'amber' | 'blue' }) {
  return <article className={`${styles.stat} ${styles[tone]}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

export function TelemetryDevicesWorkspace() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [modes, setModes] = useState<Record<string, TelemetryMode>>({});
  const [machines, setMachines] = useState<Record<string, Machine>>({});
  const [machineResults, setMachineResults] = useState<Machine[]>([]);
  const [usage, setUsage] = useState<Record<string, Usage>>({});
  const [prepaid, setPrepaid] = useState<Record<string, Prepaid>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchingMachines, setSearchingMachines] = useState(false);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestedDeviceHandled = useRef(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [transportFilter, setTransportFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [machineId, setMachineId] = useState('');
  const [machineSearch, setMachineSearch] = useState('');
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('active');
  const [transport, setTransport] = useState<TransportPreference>('auto');
  const [wifiEnabled, setWifiEnabled] = useState(true);
  const [cellularEnabled, setCellularEnabled] = useState(true);
  const [reportingMode, setReportingMode] = useState<TelemetryMode>('live');
  const [masterPolarity, setMasterPolarity] = useState<MdbPolarity>('auto');
  const [slavePolarity, setSlavePolarity] = useState<MdbPolarity>('auto');
  const [pinSwap, setPinSwap] = useState(false);
  const [locationOverride, setLocationOverride] = useState('');
  const [locationInterval, setLocationInterval] = useState(15);
  const [movementThreshold, setMovementThreshold] = useState(50);
  const [warningMb, setWarningMb] = useState(100);
  const [criticalMb, setCriticalMb] = useState(25);
  const [balanceInterval, setBalanceInterval] = useState(360);

  const selected = devices.find((device) => device.id === selectedId) ?? null;
  const selectedUsage = selected ? usage[selected.id] ?? null : null;
  const selectedPrepaid = selected ? prepaid[selected.id] ?? null : null;

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    const deviceRows = collectSupabasePagesResult<Device>(async (from, to) => {
      const { data, error: pageError } = await client
        .from('telemetry_devices')
        .select(DEVICE_SELECT)
        .order('device_code', { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as Device[], error: pageError };
    });
    const usageRows = collectSupabasePagesResult<Usage>(async (from, to) => {
      const { data, error: pageError } = await client.rpc('get_telemetry_data_usage', { p_days: 30 }).range(from, to);
      return { data: (data ?? []) as Usage[], error: pageError };
    });
    const prepaidRows = collectSupabasePagesResult<Prepaid>(async (from, to) => {
      const { data, error: pageError } = await client.rpc('get_telemetry_prepaid_balances').range(from, to);
      return { data: (data ?? []) as Prepaid[], error: pageError };
    });

    const [deviceQuery, dashboardQuery, usageQuery, prepaidQuery] = await Promise.all([
      deviceRows,
      client.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' }),
      usageRows,
      prepaidRows,
    ]);

    if (deviceQuery.error) {
      setError(deviceQuery.error.message);
      setLoading(false);
      return;
    }

    const rows = deviceQuery.data;
    setDevices(rows);
    setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : null);

    const dashboard = (dashboardQuery.data ?? {}) as { device_states?: Array<{ device_id: string; telemetry_mode?: TelemetryMode }> };
    setModes(Object.fromEntries((dashboard.device_states ?? []).map((row) => [row.device_id, row.telemetry_mode ?? 'live'])));
    setUsage(Object.fromEntries((usageQuery.error ? [] : usageQuery.data).map((row) => [row.device_id, row])));
    setPrepaid(Object.fromEntries((prepaidQuery.error ? [] : prepaidQuery.data).map((row) => [row.device_id, row])));

    const auxiliaryErrors = [dashboardQuery.error, usageQuery.error, prepaidQuery.error].filter(Boolean);
    if (auxiliaryErrors.length) {
      setError(auxiliaryErrors[0]?.message ?? 'Some telemetry device details could not be loaded.');
    }

    const machineIds = [...new Set(rows.map((row) => row.machine_id).filter((value): value is string => Boolean(value)))];
    if (machineIds.length) {
      const machineBatches: string[][] = [];
      for (let start = 0; start < machineIds.length; start += MACHINE_LOOKUP_BATCH_SIZE) {
        machineBatches.push(machineIds.slice(start, start + MACHINE_LOOKUP_BATCH_SIZE));
      }
      const machineResults = await Promise.all(machineBatches.map(async (ids) => {
        const { data, error: machineError } = await client.from('machines').select(MACHINE_SELECT).in('id', ids);
        return { data: (data ?? []) as Machine[], error: machineError };
      }));
      const firstMachineError = machineResults.find((result) => result.error)?.error;
      if (firstMachineError) {
        setMachines({});
        setError(firstMachineError.message ?? 'Machine assignment details could not be loaded.');
      } else {
        const machineRows = machineResults.flatMap((result) => result.data);
        setMachines(Object.fromEntries(machineRows.map((row) => [row.id, row])));
      }
    } else {
      setMachines({});
    }

    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (requestedDeviceHandled.current || !devices.length) return;
    requestedDeviceHandled.current = true;
    const deviceCode = new URLSearchParams(window.location.search).get('device');
    const requestedIndex = devices.findIndex((device) => device.device_code === deviceCode);
    if (requestedIndex >= 0) {
      setSelectedId(devices[requestedIndex].id);
      setPage(Math.floor(requestedIndex / pageSize) + 1);
    }
  }, [devices, pageSize]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(false); };
    const timer = globalThis.setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { globalThis.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    setMachineId(selected.machine_id ?? '');
    setDeviceStatus(selected.status === 'disabled' ? 'disabled' : 'active');
    setTransport(selected.transport_preference ?? 'auto');
    setWifiEnabled(selected.wifi_enabled ?? true);
    setCellularEnabled(selected.cellular_enabled ?? true);
    setReportingMode(modes[selected.id] ?? 'live');
    setMasterPolarity(selected.mdb_master_polarity ?? 'auto');
    setSlavePolarity(selected.mdb_slave_polarity ?? 'auto');
    setPinSwap(Boolean(selected.mdb_pin_swap));
    setLocationOverride(selected.location_override ?? '');
    setLocationInterval(selected.location_interval_minutes ?? 15);
    setMovementThreshold(selected.location_min_move_m ?? 50);
    const balance = prepaid[selected.id];
    setWarningMb(Math.round(Number(balance?.warning_threshold_bytes ?? 104_857_600) / 1_048_576));
    setCriticalMb(Math.round(Number(balance?.critical_threshold_bytes ?? 26_214_400) / 1_048_576));
    setBalanceInterval(Number(balance?.check_interval_minutes ?? 360));
    setMachineSearch('');
    setMachineResults([]);
  }, [modes, prepaid, selected]);

  const metrics = useMemo(() => {
    const active = devices.filter((device) => device.status === 'active');
    const online = active.filter((device) => deviceConnectionState(device).key === 'online').length;
    const cellular = active.filter((device) => device.last_transport === 'cellular').length;
    const lowData = Object.values(prepaid).filter((row) => ['low', 'critical', 'depleted'].includes(row.alert_level)).length;
    const totalUsage = Object.values(usage).reduce((sum, row) => sum + actualUsage(row), 0);
    return { active: active.length, online, offline: Math.max(0, active.length - online), unassigned: devices.filter((device) => !device.machine_id).length, cellular, lowData, totalUsage };
  }, [devices, prepaid, usage]);

  const filtered = useMemo(() => devices.filter((device) => {
    const status = statusKey(device);
    if (statusFilter !== 'all' && status !== statusFilter && !(statusFilter === 'unassigned' && !device.machine_id)) return false;
    if (statusFilter === 'unassigned' && device.machine_id) return false;
    if (transportFilter !== 'all' && device.last_transport !== transportFilter) return false;
    if (modeFilter !== 'all' && (modes[device.id] ?? 'live') !== modeFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    const machine = device.machine_id ? machines[device.machine_id] : null;
    return [device.device_code, device.hardware_uid, device.firmware_version, device.cellular_operator, device.profile_id, machineLabel(machine)].join(' ').toLowerCase().includes(term);
  }), [devices, machines, modeFilter, modes, search, statusFilter, transportFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [modeFilter, search, statusFilter, transportFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  async function searchMachines(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchingMachines(true);
    setError(null);
    const { data, error: searchError } = await getSupabaseClient().rpc('search_machine_assets', {
      p_search: machineSearch.trim() || null,
      p_branch: 'all', p_status: 'active', p_unlinked: null, p_offset: 0, p_limit: 100,
    });
    setSearchingMachines(false);
    if (searchError) setError(searchError.message);
    else setMachineResults((data ?? []) as Machine[]);
  }

  async function save() {
    if (!selected) return;
    if (!wifiEnabled && !cellularEnabled) { setError('At least one transport must remain enabled.'); return; }
    if (warningMb <= criticalMb || criticalMb < 0) { setError('The prepaid warning threshold must be greater than the critical threshold.'); return; }
    const client = getSupabaseClient();
    setSaving(true); setError(null); setMessage(null);

    const { error: saveError } = await client.rpc('save_telemetry_device_configuration', {
      p_device_id: selected.id,
      p_device_code: selected.device_code,
      p_machine_id: machineId || null,
      p_status: deviceStatus,
      p_mode: reportingMode,
      p_transport_preference: transport,
      p_wifi_enabled: wifiEnabled,
      p_cellular_enabled: cellularEnabled,
      p_mdb_master_polarity: masterPolarity,
      p_mdb_slave_polarity: slavePolarity,
      p_mdb_pin_swap: pinSwap,
      p_location_enabled: true,
      p_location_override: locationOverride.trim() || null,
      p_location_interval_minutes: locationInterval,
      p_location_min_move_m: movementThreshold,
      p_warning_megabytes: warningMb,
      p_critical_megabytes: criticalMb,
      p_balance_check_interval_minutes: balanceInterval,
      p_balance_stale_after_minutes: balanceInterval * 2,
    });
    if (saveError) { setError(saveError.message); setSaving(false); return; }

    setMessage(`${selected.device_code} configuration saved atomically. Sync status will update when the controller fetches and acknowledges it.`);
    await load(false);
    setSaving(false);
  }

  async function checkBalance() {
    if (!selected) return;
    setCheckingBalance(true); setError(null);
    const { error: requestError } = await getSupabaseClient().rpc('request_telemetry_prepaid_balance', { p_device_code: selected.device_code });
    if (requestError) setError(requestError.message);
    else { setMessage(`Balance check queued for ${selected.device_code}.`); await load(false); }
    setCheckingBalance(false);
  }

  async function deleteDevice() {
    if (!selected || deleteConfirmation.trim() !== selected.device_code) return;
    setDeleting(true); setError(null);
    const code = selected.device_code;
    const { error: deleteError } = await getSupabaseClient().rpc('delete_telemetry_device', { p_device_id: selected.id, p_device_code: code });
    if (deleteError) { setError(deleteError.message); setDeleting(false); return; }
    setDeleteOpen(false); setDeleteConfirmation(''); setSelectedId(null); setMessage(`${code} and its telemetry history were deleted.`);
    await load(false); setDeleting(false);
  }

  const selectedUsed = actualUsage(selectedUsage);
  const selectedProjected = projectedUsage(selectedUsage);
  const selectedHealth = selected ? deviceConnectionState(selected) : null;
  const selectedConfig = selected ? deviceConfigSyncState(selected) : null;
  const selectedStatus = selectedHealth?.key ?? 'offline';
  const currentMachine = machineId ? (machineResults.find((row) => row.id === machineId) ?? machines[machineId] ?? null) : null;
  const machineOptions = currentMachine && !machineResults.some((row) => row.id === currentMachine.id) ? [currentMachine, ...machineResults] : machineResults;

  return <section className={styles.workspace} data-telemetry-devices="v3">
    {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert"><strong>Device management error</strong><span>{error}</span></div> : null}
    {message ? <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status"><strong>Saved</strong><span>{message}</span></div> : null}

    <TelemetryEnrollmentWindowControl onDeviceEnrolled={() => load(false)} />

    <section className={styles.stats} aria-label="Telemetry device summary">
      <Stat detail="Provisioned controllers" label="Active devices" tone="blue" value={metrics.active.toLocaleString('en-ZA')} />
      <Stat detail="Heartbeat within 30 min" label="Online" tone="green" value={metrics.online.toLocaleString('en-ZA')} />
      <Stat detail="Needs attention" label="Offline" tone={metrics.offline ? 'red' : 'green'} value={metrics.offline.toLocaleString('en-ZA')} />
      <Stat detail="Needs machine link" label="Unassigned" tone={metrics.unassigned ? 'amber' : 'green'} value={metrics.unassigned.toLocaleString('en-ZA')} />
      <Stat detail="Current transport" label="On cellular" value={metrics.cellular.toLocaleString('en-ZA')} />
      <Stat detail="Fleet · last 30 days" label="Data used" tone="amber" value={formatBytes(metrics.totalUsage)} />
    </section>

    <section className={styles.toolbar}>
      <label className={styles.search}><NavigationIcon kind="search" /><input aria-label="Search telemetry devices" placeholder="Search device, firmware, machine or operator" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <select aria-label="Filter device status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All status</option><option value="online">Online</option><option value="offline">Offline</option><option value="unassigned">Unassigned</option><option value="disabled">Disabled</option></select>
      <select aria-label="Filter transport" value={transportFilter} onChange={(event) => setTransportFilter(event.target.value)}><option value="all">All networks</option><option value="wifi">Wi-Fi</option><option value="cellular">Cellular</option></select>
      <select aria-label="Filter reporting mode" value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}><option value="all">All modes</option><option value="live">Live</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select>
      <button className={styles.refresh} disabled={loading} onClick={() => void load(false)} type="button"><NavigationIcon kind="telemetry" />Refresh</button>
      <small>{filtered.length.toLocaleString('en-ZA')} matching · {devices.length.toLocaleString('en-ZA')} controllers · updated {lastUpdated ? lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</small>
    </section>

    {loading && !devices.length ? <HamsterLoader label="Loading telemetry devices" /> : <section className={styles.register}>
      <div className={styles.tableWrap}><table><thead><tr><th>Device</th><th>Machine</th><th>State</th><th>Network</th><th>Signal</th><th>Reporting</th><th>30-day data</th><th>SIM remaining</th><th>Last contact</th><th /></tr></thead><tbody>
        {pageRows.map((device) => {
          const state = statusKey(device);
          const deviceUsage = usage[device.id];
          const balance = prepaid[device.id];
          const machine = device.machine_id ? machines[device.machine_id] : null;
          return <tr key={device.id} className={selectedId === device.id ? styles.selectedRow : undefined}>
            <td><strong>{device.device_code}</strong><small>{device.firmware_version ?? 'Firmware unknown'}</small></td>
            <td><strong>{machineLabel(machine)}</strong><small>{machine?.branch?.toUpperCase() ?? (device.machine_id ? 'Loading machine…' : 'Assign from settings')}</small></td>
            <td><span className={`${styles.pill} ${styles[state]}`}><i />{state}</span></td>
            <td><strong>{device.last_transport === 'wifi' ? 'Wi-Fi' : device.last_transport === 'cellular' ? 'Cellular' : '—'}</strong><small>{device.cellular_operator ?? ''}</small></td>
            <td>{device.last_transport ? <SignalStrengthIndicator cellularCsq={device.cellular_csq} transport={device.last_transport} wifiRssi={device.wifi_rssi} /> : '—'}</td>
            <td><span className={styles.mode}>{modes[device.id] ?? 'live'}</span></td>
            <td><strong>{formatBytes(actualUsage(deviceUsage))}</strong><small>{deviceUsage ? `${Number(deviceUsage.request_count ?? 0).toLocaleString('en-ZA')} uploads` : 'No samples'}</small></td>
            <td><strong className={balance && ['low', 'critical', 'depleted'].includes(balance.alert_level) ? styles.warningText : undefined}>{balance?.remaining_bytes != null ? formatBytes(balance.remaining_bytes) : '—'}</strong><small>{balance?.alert_level ?? 'not reported'}</small></td>
            <td><strong>{age(device.last_heartbeat_at ?? device.last_seen_at)}</strong><small>{formatDate(device.last_heartbeat_at ?? device.last_seen_at)}</small></td>
            <td><button className={styles.manage} onClick={() => { setSelectedId(device.id); setMessage(null); setError(null); }} type="button">Manage</button></td>
          </tr>;
        })}
      </tbody></table></div>
      <div className={styles.mobileCards}>{pageRows.map((device) => { const state = statusKey(device); const deviceUsage = usage[device.id]; const balance = prepaid[device.id]; const machine = device.machine_id ? machines[device.machine_id] : null; return <button className={styles.deviceCard} key={device.id} onClick={() => setSelectedId(device.id)} type="button"><div><strong>{device.device_code}</strong><span className={`${styles.pill} ${styles[state]}`}><i />{state}</span></div><span>{machineLabel(machine)}</span><dl><div><dt>Network</dt><dd>{device.last_transport ?? '—'}</dd></div><div><dt>Data</dt><dd>{formatBytes(actualUsage(deviceUsage))}</dd></div><div><dt>SIM</dt><dd>{balance?.remaining_bytes != null ? formatBytes(balance.remaining_bytes) : '—'}</dd></div><div><dt>Seen</dt><dd>{age(device.last_heartbeat_at ?? device.last_seen_at)}</dd></div></dl></button>; })}</div>
      {!filtered.length ? <div className={styles.empty}>No telemetry devices match these filters.</div> : null}
      {filtered.length ? <DeviceRegisterPagination
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => { setPageSize(nextPageSize); setPage(1); }}
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        total={filtered.length}
      /> : null}
    </section>}

    {selected ? <aside className={styles.drawer} aria-label={`Manage ${selected.device_code}`}>
      <header className={styles.drawerHeader}><div><span>Telemetry controller</span><h2>{selected.device_code}</h2><p><span className={`${styles.pill} ${styles[selectedStatus]}`}><i />{selectedHealth?.label ?? 'Offline'}</span> · {transportLabel(selected.last_transport)} · {age(selectedHealth?.contactAt ?? null)}</p></div><button aria-label="Close device settings" onClick={() => setSelectedId(null)} type="button">×</button></header>

      <div className={styles.drawerBody}>
        <section className={styles.controlSection} data-device-health-summary="v1"><div className={styles.sectionTitle}><span>Live state</span><h3>Device health</h3></div><div className={styles.healthGrid}><div><span>Communication</span><strong>{selectedHealth?.label ?? 'Offline'}</strong><small>{selectedHealth?.key === 'online' ? 'Confirmed device contact within 30 min' : selectedHealth?.key === 'disabled' ? 'Controller is disabled' : selectedHealth?.contactAt ? 'No confirmed device contact in 30 min' : 'No telemetry contact has been recorded'}</small></div><div><span>Last contact</span><strong>{age(selectedHealth?.contactAt ?? null)}</strong><small>{formatDate(selectedHealth?.contactAt ?? null)}</small></div><div><span>Transport</span><strong>{transportLabel(selected.last_transport)}</strong><small>{transportDetail(selected)}</small></div><div><span>Signal</span><strong>{selected.last_transport ? <SignalStrengthIndicator cellularCsq={selected.cellular_csq} transport={selected.last_transport} wifiRssi={selected.wifi_rssi} /> : '—'}</strong><small>{selected.last_transport ? 'Active transport measurement' : 'Awaiting network telemetry'}</small></div><div><span>Configuration</span><strong>{selectedConfig?.label ?? 'Not reported'}</strong><small>{selectedConfig?.timestamp ? formatDate(selectedConfig.timestamp) : 'No device configuration has been queued'}</small></div><div><span>Data use · 30 days</span><strong>{formatBytes(selectedUsed)}</strong><small>{usageDetail(selectedUsage, selectedProjected)}</small></div></div></section>

        <section className={styles.controlSection}><div className={styles.sectionTitle}><span>Assignment</span><h3>Machine link</h3></div><div className={styles.currentMachine}>{machineLabel(currentMachine)}</div><form className={styles.machineSearch} onSubmit={searchMachines}><input placeholder="Machine name, serial or asset tag" value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} /><button disabled={searchingMachines} type="submit">{searchingMachines ? 'Searching…' : 'Find'}</button></form>{machineOptions.length ? <select value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">Unassign device</option>{machineOptions.map((machine) => <option key={machine.id} value={machine.id}>{machineLabel(machine)}</option>)}</select> : <button className={styles.unassign} onClick={() => setMachineId('')} type="button">Clear assignment</button>}</section>

        <section className={styles.controlSection}><div className={styles.sectionTitle}><span>Connectivity</span><h3>Transport control</h3></div><label className={styles.field}><span>Preferred network</span><select value={transport} onChange={(event) => setTransport(event.target.value as TransportPreference)}><option value="auto">Auto · Wi-Fi first</option><option value="wifi">Wi-Fi preferred</option><option value="cellular">Cellular preferred</option></select></label><div className={styles.switchRow}><label><input checked={wifiEnabled} onChange={(event) => setWifiEnabled(event.target.checked)} type="checkbox" /><span>Wi-Fi enabled</span></label><label><input checked={cellularEnabled} onChange={(event) => setCellularEnabled(event.target.checked)} type="checkbox" /><span>Cellular enabled</span></label></div></section>

        <section className={styles.controlSection} data-mdb-pin-control="true"><div className={styles.sectionTitle}><span>Passive MDB</span><h3>Signal & pin order</h3></div><div className={styles.pinDiagram}><div className={!pinSwap ? styles.pinActive : undefined}><b>GPIO4</b><span>{pinSwap ? 'Master-RX' : 'Master-TX'}</span><small>{pinSwap ? 'Yellow / MDB pin 4' : 'Green / MDB pin 5'}</small></div><div className={pinSwap ? styles.pinActive : undefined}><b>GPIO5</b><span>{pinSwap ? 'Master-TX' : 'Master-RX'}</span><small>{pinSwap ? 'Green / MDB pin 5' : 'Yellow / MDB pin 4'}</small></div></div><div className={styles.segmented} role="group" aria-label="MDB passive pin order"><button aria-pressed={!pinSwap} className={!pinSwap ? styles.segmentActive : undefined} onClick={() => setPinSwap(false)} type="button">Standard</button><button aria-pressed={pinSwap} className={pinSwap ? styles.segmentActive : undefined} onClick={() => setPinSwap(true)} type="button">Swapped</button></div><div className={styles.twoFields}><label className={styles.field}><span>Master-TX polarity</span><select value={masterPolarity} onChange={(event) => setMasterPolarity(event.target.value as MdbPolarity)}><option value="auto">Auto detect</option><option value="normal">Normal</option><option value="inverted">Inverted</option></select></label><label className={styles.field}><span>Master-RX polarity</span><select value={slavePolarity} onChange={(event) => setSlavePolarity(event.target.value as MdbPolarity)}><option value="auto">Auto detect</option><option value="normal">Normal</option><option value="inverted">Inverted</option></select></label></div><p className={styles.safety}>GPIO4 and GPIO5 remain input-only. Changing pin order only changes which passive RMT input is decoded as Master-TX or Master-RX.</p></section>

        <section className={styles.controlSection}><div className={styles.sectionTitle}><span>Aggregation</span><h3>Reporting</h3></div><div className={styles.twoFields}><label className={styles.field}><span>Counter mode</span><select value={reportingMode} onChange={(event) => setReportingMode(event.target.value as TelemetryMode)}><option value="live">Live</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select></label><label className={styles.field}><span>Location interval</span><select value={locationInterval} onChange={(event) => setLocationInterval(Number(event.target.value))}><option value={1}>1 minute</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={1440}>Daily</option></select></label><label className={styles.field}><span>Movement threshold</span><select value={movementThreshold} onChange={(event) => setMovementThreshold(Number(event.target.value))}><option value={25}>±25 m</option><option value={50}>±50 m</option><option value={100}>±100 m</option><option value={250}>±250 m</option><option value={500}>±500 m</option></select></label><label className={styles.field}><span>Location override</span><input placeholder="Use machine site by default" value={locationOverride} onChange={(event) => setLocationOverride(event.target.value)} /></label></div></section>

        <section className={styles.controlSection}><div className={styles.sectionTitle}><span>Vodacom prepaid</span><h3>Data balance</h3></div><div className={styles.balanceHero}><div><span>Used · 30 days</span><strong>{formatBytes(selectedUsed)}</strong></div><div className={selectedPrepaid && ['low', 'critical', 'depleted'].includes(selectedPrepaid.alert_level) ? styles.balanceWarning : undefined}><span>Remaining</span><strong>{selectedPrepaid?.remaining_bytes != null ? formatBytes(selectedPrepaid.remaining_bytes) : 'Unavailable'}</strong></div></div><div className={styles.threeFields}><label className={styles.field}><span>Low warning · MB</span><input min={1} type="number" value={warningMb} onChange={(event) => setWarningMb(Number(event.target.value))} /></label><label className={styles.field}><span>Critical · MB</span><input min={0} type="number" value={criticalMb} onChange={(event) => setCriticalMb(Number(event.target.value))} /></label><label className={styles.field}><span>Check interval</span><select value={balanceInterval} onChange={(event) => setBalanceInterval(Number(event.target.value))}><option value={60}>1 hour</option><option value={180}>3 hours</option><option value={360}>6 hours</option><option value={720}>12 hours</option><option value={1440}>Daily</option></select></label></div><button className={styles.secondaryAction} disabled={checkingBalance || selectedPrepaid?.request_pending || selectedPrepaid?.query_status === 'unsupported_modem_firmware'} onClick={() => void checkBalance()} type="button">{selectedPrepaid?.query_status === 'unsupported_modem_firmware' ? 'Carrier balance unavailable' : selectedPrepaid?.request_pending ? 'Balance check queued' : checkingBalance ? 'Queuing…' : 'Check balance now'}</button><small>Vodacom billing remains authoritative. Air780EU firmware may not expose prepaid USSD balance queries.</small></section>

        <TelemetryConfigSyncPanel key={`${selected.id}:${selected.updated_at}`} deviceId={selected.id} />

        <section className={styles.controlSection}><div className={styles.sectionTitle}><span>Administration</span><h3>Device status</h3></div><label className={styles.field}><span>Controller state</span><select value={deviceStatus} onChange={(event) => setDeviceStatus(event.target.value as DeviceStatus)}><option value="active">Active</option><option value="disabled">Disabled</option></select></label><dl className={styles.audit}><div><dt>Hardware UID</dt><dd>{selected.hardware_uid ?? 'Not reported'}</dd></div><div><dt>Profile</dt><dd>{selected.profile_id ?? 'Automatic'}</dd></div><div><dt>Config sent</dt><dd>{formatDate(selected.last_config_at)}</dd></div><div><dt>Config ACK</dt><dd>{formatDate(selected.last_config_ack_at)}</dd></div></dl><button className={styles.deleteButton} onClick={() => { setDeleteConfirmation(''); setDeleteOpen(true); }} type="button">Delete telemetry device</button></section>
      </div>

      <footer className={styles.drawerFooter}><button className={styles.cancel} disabled={saving} onClick={() => setSelectedId(null)} type="button">Close</button><button className={styles.save} disabled={saving} onClick={() => void save()} type="button">{saving ? 'Saving configuration…' : 'Save & send configuration'}</button></footer>
    </aside> : null}

    <AccessibleDialog ariaLabel="Confirm telemetry device deletion" closeOnBackdrop={!deleting} id="delete-telemetry-device-dialog-v2" onClose={() => { if (!deleting) setDeleteOpen(false); }} open={deleteOpen && Boolean(selected)}>
      {selected ? <div className={styles.deleteDialog}><header><div><span>Permanent action</span><h2>Delete {selected.device_code}?</h2></div><button aria-label="Close deletion dialog" disabled={deleting} onClick={() => setDeleteOpen(false)} type="button">×</button></header><p>This removes the controller and its associated telemetry history. The machine record itself is retained.</p><label><span>Type <strong>{selected.device_code}</strong> to confirm</span><input autoComplete="off" data-dialog-initial-focus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><footer><button disabled={deleting} onClick={() => setDeleteOpen(false)} type="button">Cancel</button><button className={styles.deleteButton} disabled={deleting || deleteConfirmation.trim() !== selected.device_code} onClick={() => void deleteDevice()} type="button">{deleting ? 'Deleting…' : 'Permanently delete'}</button></footer></div> : null}
    </AccessibleDialog>
  </section>;
}
