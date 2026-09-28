'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineManagementPanel.module.css';

type Machine = {
  id: string;
  machine_name: string | null;
  model: string | null;
  manufacturer: string | null;
  customer_id: string | null;
  site_id: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  status: string;
  branch: string;
};

type Customer = { id: string; customer_name: string; status?: string };
type Site = { id: string; customer_id?: string; site_name: string; address: string | null; status?: string };
type Device = {
  id: string;
  device_code: string;
  status: string;
  hardware_uid: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_transport: string | null;
  cellular_operator: string | null;
  machine_link_status: string | null;
};

type Draft = {
  machineName: string;
  model: string;
  manufacturer: string;
  customerId: string;
  siteId: string;
  serialNumber: string;
  barcode: string;
  status: string;
};

function emptyDraft(): Draft {
  return { machineName: '', model: '', manufacturer: '', customerId: '', siteId: '', serialNumber: '', barcode: '', status: 'active' };
}

function toDraft(machine: Machine): Draft {
  return {
    machineName: machine.machine_name ?? '',
    model: machine.model ?? '',
    manufacturer: machine.manufacturer ?? '',
    customerId: machine.customer_id ?? '',
    siteId: machine.site_id ?? '',
    serialNumber: machine.serial_number ?? '',
    barcode: machine.machine_barcode ?? '',
    status: machine.status,
  };
}

function normalizeRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') return [value as T];
  return [];
}

function dateTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never';
}

export function MachineManagementPanel({ machineId }: { machineId: string }) {
  const [machine, setMachine] = useState<Machine | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [linkedDevice, setLinkedDevice] = useState<Device | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceResults, setDeviceResults] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const [machineQuery, customerQuery, siteQuery, deviceQuery] = await Promise.all([
        client.from('machines')
          .select('id,machine_name,model,manufacturer,customer_id,site_id,serial_number,machine_barcode,status,branch')
          .eq('id', machineId)
          .maybeSingle(),
        client.from('customers').select('id,customer_name,status').eq('status', 'active').order('customer_name'),
        client.from('customer_sites').select('id,customer_id,site_name,address,status').eq('status', 'active').order('site_name'),
        client.from('telemetry_devices')
          .select('id,device_code,status,hardware_uid,firmware_version,last_seen_at,last_transport,cellular_operator,machine_link_status')
          .eq('machine_id', machineId)
          .neq('status', 'retired')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (machineQuery.error) throw machineQuery.error;
      if (customerQuery.error) throw customerQuery.error;
      if (siteQuery.error) throw siteQuery.error;
      if (deviceQuery.error) throw deviceQuery.error;
      if (!machineQuery.data) throw new Error('Machine not found in the selected telemetry region.');

      const nextMachine = machineQuery.data as Machine;
      setMachine(nextMachine);
      setDraft(toDraft(nextMachine));
      setCustomers(normalizeRows<Customer>(customerQuery.data));
      setSites(normalizeRows<Site>(siteQuery.data));
      setLinkedDevice(deviceQuery.data as Device | null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Machine management data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => { void load(); }, [load]);

  const customerSites = useMemo(
    () => sites.filter((site) => !site.customer_id || site.customer_id === draft.customerId),
    [draft.customerId, sites],
  );
  const selectedDevice = useMemo(
    () => deviceResults.find((device) => device.id === selectedDeviceId) ?? null,
    [deviceResults, selectedDeviceId],
  );

  async function saveMachine(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!draft.machineName.trim() || !draft.model.trim() || !draft.manufacturer.trim() || !draft.customerId || !draft.serialNumber.trim() || !draft.barcode.trim()) {
      setError('Asset Name, Machine Type, Brand, Client, Serial Number and QR Code Number are required.');
      return;
    }

    setSaving(true);
    try {
      const { error: saveError } = await getSupabaseClient().rpc('update_telemetry_machine', {
        p_machine_id: machineId,
        p_machine_name: draft.machineName.trim(),
        p_model: draft.model.trim(),
        p_manufacturer: draft.manufacturer.trim(),
        p_customer_id: draft.customerId,
        p_site_id: draft.siteId || null,
        p_serial_number: draft.serialNumber.trim(),
        p_machine_barcode: draft.barcode.trim(),
        p_status: draft.status,
      });
      if (saveError) throw saveError;
      setEditing(false);
      await load();
      setSuccess('Machine details were updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The machine could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  async function searchDevices() {
    setError(null);
    setSuccess(null);
    setDeviceBusy(true);
    try {
      const { data, error: searchError } = await getSupabaseClient().rpc('search_unlinked_telemetry_devices', {
        p_search: deviceSearch.trim() || null,
        p_limit: 100,
      });
      if (searchError) throw searchError;
      const rows = normalizeRows<Device>(data);
      setDeviceResults(rows);
      setSelectedDeviceId((current) => rows.some((row) => row.id === current) ? current : '');
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Unlinked telemetry devices could not be loaded.');
    } finally {
      setDeviceBusy(false);
    }
  }

  async function linkDevice() {
    if (!selectedDevice) return;
    setError(null);
    setSuccess(null);
    setDeviceBusy(true);
    try {
      const { error: linkError } = await getSupabaseClient().rpc('link_telemetry_device', {
        p_machine_id: machineId,
        p_device_id: selectedDevice.id,
        p_device_code: selectedDevice.device_code,
      });
      if (linkError) throw linkError;
      const code = selectedDevice.device_code;
      setDeviceResults([]);
      setSelectedDeviceId('');
      await load();
      setSuccess(`${code} was linked to this machine.`);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'The telemetry device could not be linked.');
    } finally {
      setDeviceBusy(false);
    }
  }

  async function unlinkDevice() {
    if (!linkedDevice) return;
    setError(null);
    setSuccess(null);
    setDeviceBusy(true);
    try {
      const code = linkedDevice.device_code;
      const { error: unlinkError } = await getSupabaseClient().rpc('unlink_telemetry_device', {
        p_machine_id: machineId,
        p_device_id: linkedDevice.id,
        p_device_code: code,
      });
      if (unlinkError) throw unlinkError;
      await load();
      setSuccess(`${code} was unlinked from this machine.`);
    } catch (unlinkError) {
      setError(unlinkError instanceof Error ? unlinkError.message : 'The telemetry device could not be unlinked.');
    } finally {
      setDeviceBusy(false);
    }
  }

  if (loading && !machine) {
    return <section className={styles.panel}><p className={styles.muted}>Loading machine management…</p></section>;
  }

  return (
    <section className={styles.panel} aria-labelledby="machine-management-title">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Machine management</span>
          <h2 id="machine-management-title">Asset details & telemetry device</h2>
          <p>Edit the selected machine and control its one-to-one telemetry device assignment.</p>
        </div>
        {machine && !editing ? (
          <button className={styles.secondaryButton} type="button" onClick={() => { setEditing(true); setError(null); setSuccess(null); }}>Edit machine</button>
        ) : null}
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {success ? <div className={styles.success} role="status">{success}</div> : null}

      {machine ? editing ? (
        <form className={styles.form} onSubmit={saveMachine}>
          <label><span>Asset Name</span><input value={draft.machineName} onChange={(event) => setDraft({ ...draft, machineName: event.target.value })} required /></label>
          <label><span>Machine Type</span><input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} required /></label>
          <label><span>Brand</span><input value={draft.manufacturer} onChange={(event) => setDraft({ ...draft, manufacturer: event.target.value })} required /></label>
          <label><span>Client</span><select value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value, siteId: '' })} required><option value="">Choose client</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_name}</option>)}</select></label>
          <label><span>Site</span><select value={draft.siteId} onChange={(event) => setDraft({ ...draft, siteId: event.target.value })}><option value="">No site</option>{customerSites.map((site) => <option key={site.id} value={site.id}>{site.site_name}{site.address ? ` — ${site.address}` : ''}</option>)}</select></label>
          <label><span>Serial Number</span><input value={draft.serialNumber} onChange={(event) => setDraft({ ...draft, serialNumber: event.target.value })} required /></label>
          <label><span>QR Code Number</span><input value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} required /></label>
          <label><span>Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option><option value="repair">Repair</option><option value="retired">Retired</option><option value="unknown">Unknown</option></select></label>
          <div className={styles.formActions}>
            <button className={styles.primaryButton} disabled={saving} type="submit">{saving ? 'Saving…' : 'Save changes'}</button>
            <button className={styles.secondaryButton} disabled={saving} type="button" onClick={() => { setDraft(toDraft(machine)); setEditing(false); setError(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <dl className={styles.summaryGrid}>
          <div><dt>Asset Name</dt><dd>{machine.machine_name ?? '—'}</dd></div>
          <div><dt>Machine Type</dt><dd>{machine.model ?? '—'}</dd></div>
          <div><dt>Brand</dt><dd>{machine.manufacturer ?? '—'}</dd></div>
          <div><dt>Serial Number</dt><dd>{machine.serial_number ?? '—'}</dd></div>
          <div><dt>QR Code</dt><dd>{machine.machine_barcode ?? '—'}</dd></div>
          <div><dt>Status</dt><dd>{machine.status}</dd></div>
          <div><dt>Branch</dt><dd>{machine.branch}</dd></div>
        </dl>
      ) : null}

      <div className={styles.divider} />

      <div className={styles.deviceSection}>
        <div>
          <h3>Telemetry device</h3>
          <p>{linkedDevice ? 'This machine currently has one telemetry device assigned.' : 'No telemetry device is linked to this machine.'}</p>
        </div>

        {linkedDevice ? (
          <article className={styles.deviceCard}>
            <div><strong>{linkedDevice.device_code}</strong><span>{linkedDevice.status} · {linkedDevice.last_transport ?? 'transport unknown'}</span></div>
            <dl>
              <div><dt>Hardware UID</dt><dd>{linkedDevice.hardware_uid ?? 'Not reported'}</dd></div>
              <div><dt>Firmware</dt><dd>{linkedDevice.firmware_version ?? 'Not reported'}</dd></div>
              <div><dt>Last contact</dt><dd>{dateTime(linkedDevice.last_seen_at)}</dd></div>
              <div><dt>Operator</dt><dd>{linkedDevice.cellular_operator ?? 'Not reported'}</dd></div>
            </dl>
            <button className={styles.dangerButton} disabled={deviceBusy} type="button" onClick={() => void unlinkDevice()}>{deviceBusy ? 'Updating…' : 'Unlink device'}</button>
          </article>
        ) : (
          <div className={styles.linkArea}>
            <div className={styles.searchRow}>
              <label><span>Find unlinked telemetry device</span><input placeholder="Device ID, hardware UID, firmware or operator" value={deviceSearch} onChange={(event) => setDeviceSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchDevices(); } }} /></label>
              <button className={styles.secondaryButton} disabled={deviceBusy} type="button" onClick={() => void searchDevices()}>{deviceBusy ? 'Searching…' : 'Search'}</button>
            </div>
            {deviceResults.length ? (
              <div className={styles.results}>
                {deviceResults.map((device) => (
                  <label className={`${styles.resultRow} ${selectedDeviceId === device.id ? styles.selected : ''}`} key={device.id}>
                    <input type="radio" name="device" value={device.id} checked={selectedDeviceId === device.id} onChange={() => setSelectedDeviceId(device.id)} />
                    <span><strong>{device.device_code}</strong><small>{device.status} · {device.firmware_version ?? 'firmware unknown'} · last contact {dateTime(device.last_seen_at)}</small></span>
                  </label>
                ))}
                <button className={styles.primaryButton} disabled={!selectedDevice || deviceBusy} type="button" onClick={() => void linkDevice()}>{deviceBusy ? 'Linking…' : 'Link selected device'}</button>
              </div>
            ) : <p className={styles.muted}>Search to show available devices in the selected telemetry region.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
