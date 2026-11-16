import { buildFleetAttentionItems, type FleetAttentionDevice, type FleetAttentionBalance, type FleetAttentionItem } from './fleet-attention';

export type OverviewMachine = {
  id: string;
  customer_id: string | null;
  site_id: string | null;
  machine_type: string | null;
  machine_name: string | null;
  customers?: { customer_name: string } | { customer_name: string }[] | null;
  customer_sites?: { site_name: string } | { site_name: string }[] | null;
};

export type OverviewAttentionItem = Omit<FleetAttentionItem, 'kind'> & { kind: FleetAttentionItem['kind'] | 'fault' | 'raw_fault' | 'diagnostic' };
export type OverviewAttentionCategory = 'all' | 'fault' | 'connectivity' | 'verification' | 'device';
export type OverviewAttentionFilters = {
  customerId?: string;
  siteId?: string;
  machineType?: string;
  category?: OverviewAttentionCategory;
};

export function needsVerification(item: OverviewAttentionItem) {
  return item.kind === 'raw_fault' || item.kind === 'unknown' || item.kind === 'never_seen'
    || ((item.kind === 'communication' || item.kind === 'reporting') && item.evidenceState === 'unknown');
}

/** Filter before pagination; counts describe unique machines, never issue rows. */
export function selectOverviewAttention(items: OverviewAttentionItem[], machines: OverviewMachine[], filters: OverviewAttentionFilters) {
  const byId = new Map(machines.map((machine) => [machine.id, machine]));
  const matches = items.filter((item) => {
    const machine = item.machineId ? byId.get(item.machineId) : undefined;
    if (filters.customerId && machine?.customer_id !== filters.customerId) return false;
    if (filters.siteId && machine?.site_id !== filters.siteId) return false;
    if (filters.machineType === '__not_reported__') {
      if (!machine || machine.machine_type) return false;
    } else if (filters.machineType && machine?.machine_type !== filters.machineType) return false;
    switch (filters.category) {
      case 'fault': return item.kind === 'fault' || item.kind === 'raw_fault';
      case 'connectivity': return item.kind === 'offline' || item.kind === 'delayed';
      case 'verification': return needsVerification(item);
      case 'device': return ['diagnostic', 'config', 'sim_balance', 'network'].includes(item.kind);
      default: return true;
    }
  });
  return {
    actionable: matches.filter((item) => !needsVerification(item)),
    verification: matches.filter(needsVerification),
    machineCount: new Set(matches.flatMap((item) => item.machineId ? [item.machineId] : [])).size,
    unassignedDeviceCount: new Set(matches.filter((item) => !item.machineId).map((item) => item.deviceId)).size,
  };
}

export type OverviewFault = { id: string; device_id: string; machine_id: string | null; fault_code: string; severity: string; started_at: string; normalization_status?: string | null; canonical_title?: string | null; recommended_action?: string | null };

/** Open faults are independent of the date window used for historical charts. */
export function buildOverviewAttention(devices: FleetAttentionDevice[], balances: FleetAttentionBalance[], machines: OverviewMachine[], faults: OverviewFault[], now: number): OverviewAttentionItem[] {
  const deviceCodes = new Map(devices.map((device) => [device.id, device.device_code]));
  const linked = new Set(devices.filter((device) => device.status === 'active').map((device) => device.machine_id));
  const faultItems: OverviewAttentionItem[] = faults.map((fault) => ({
    id: `fault:${fault.id}`, kind: fault.normalization_status === 'verified_rule' ? 'fault' : fault.normalization_status === 'telemetry_diagnostic' ? 'diagnostic' : 'raw_fault', priority: 0,
    severity: fault.normalization_status === 'verified_rule' && ['critical', 'high', 'error'].includes(fault.severity.toLowerCase()) ? 'critical' : 'warning',
    deviceId: fault.device_id, deviceCode: deviceCodes.get(fault.device_id) ?? 'Device identifier unavailable',
    machineId: fault.machine_id, occurredAt: fault.started_at, remainingBytes: null, balanceAlert: null, lastTransport: null,
    title: fault.normalization_status === 'verified_rule' ? `Verified machine fault: ${fault.canonical_title || fault.fault_code}` : fault.normalization_status === 'telemetry_diagnostic' ? `Telemetry diagnostic: ${fault.fault_code}` : `Uninterpreted fault code: ${fault.fault_code}`,
    reason: fault.normalization_status === 'verified_rule' ? fault.recommended_action || 'Inspect the machine fault history and follow the verified machine-profile guidance.' : fault.normalization_status === 'telemetry_diagnostic' ? 'This is a telemetry-platform diagnostic, not a confirmed machine fault. Review the device diagnostics.' : 'This raw event needs a verified machine-profile interpretation before its meaning can be established.',
  }));
  const unlinked: OverviewAttentionItem[] = machines.filter((machine) => !linked.has(machine.id)).map((machine) => ({
    id: `unlinked:${machine.id}`, kind: 'unknown', priority: 5, severity: 'warning',
    deviceId: '', deviceCode: 'No active telemetry device', machineId: machine.id, occurredAt: null,
    remainingBytes: null, balanceAlert: null, lastTransport: null,
    title: 'Telemetry assignment: Unknown', reason: 'No active telemetry device is assigned. Connectivity, communication and sales completeness cannot be established.',
  }));
  return [...faultItems, ...buildFleetAttentionItems(devices, balances, now), ...unlinked];
}
