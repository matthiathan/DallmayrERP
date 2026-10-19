'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import { collectSupabasePagesResult } from '@/lib/supabase/collect-pages';
import { deviceConfigSyncState, deviceConnectionState } from '@/lib/telemetry/device-health';
import styles from './FactoryWorkspace.module.css';

type FactoryTab = 'devices' | 'provisioning' | 'testing' | 'firmware' | 'qa' | 'batches';
type Device = {
  id: string;
  device_code: string;
  hardware_uid: string | null;
  machine_id: string | null;
  profile_id: string | null;
  status: string;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  last_config_at: string | null;
  last_config_ack_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  updated_at: string;
};

const DEVICE_SELECT = 'id,device_code,hardware_uid,machine_id,profile_id,status,firmware_version,last_seen_at,last_heartbeat_at,last_config_at,last_config_ack_at,last_transport,wifi_rssi,cellular_csq,cellular_operator,updated_at';

const tabs: Array<{ id: FactoryTab; label: string }> = [
  { id: 'devices', label: 'Devices' },
  { id: 'provisioning', label: 'Provisioning' },
  { id: 'testing', label: 'Testing' },
  { id: 'firmware', label: 'Firmware' },
  { id: 'qa', label: 'QA' },
  { id: 'batches', label: 'Batches' },
];

function dateTime(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function evidence(device: Device) {
  const identity = Boolean(device.hardware_uid);
  const firmware = Boolean(device.firmware_version);
  const communication = Boolean(device.last_heartbeat_at ?? device.last_seen_at);
  const network = Boolean(device.last_transport);
  const cellular = device.last_transport === 'cellular' || Boolean(device.cellular_operator) || device.cellular_csq !== null;
  const config = Boolean(device.last_config_ack_at);
  const checks = [identity, firmware, communication, network, config];
  const completed = checks.filter(Boolean).length;
  return { identity, firmware, communication, network, cellular, config, completed, total: checks.length };
}

function readinessLabel(device: Device) {
  const result = evidence(device);
  if (device.status === 'disabled') return 'Disabled';
  if (result.completed === result.total) return 'Operational evidence complete';
  if (result.identity && result.firmware) return 'Testing evidence pending';
  return 'Provisioning evidence pending';
}

export function FactoryWorkspace() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [tab, setTab] = useState<FactoryTab>('devices');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    const rows = await collectSupabasePagesResult<Device>(async (from, to) => {
      const { data, error: pageError } = await getSupabaseClient().from('telemetry_devices').select(DEVICE_SELECT).order('updated_at', { ascending: false }).range(from, to);
      return { data: (data ?? []) as Device[], error: pageError };
    });
    if (rows.error) {
      setError(rows.error.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setDevices(rows.data);
    setSelectedId((current) => current && rows.data.some((device) => device.id === current) ? current : null);
    setUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
    return () => globalThis.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = devices;
    if (tab === 'provisioning') rows = rows.filter((device) => !evidence(device).identity || !evidence(device).firmware);
    if (tab === 'testing') rows = rows.filter((device) => evidence(device).identity && evidence(device).firmware && evidence(device).completed < evidence(device).total);
    if (tab === 'firmware') rows = [...rows].sort((a, b) => (a.firmware_version ?? '').localeCompare(b.firmware_version ?? ''));
    if (!term) return rows;
    return rows.filter((device) => [device.device_code, device.hardware_uid, device.firmware_version, device.cellular_operator, readinessLabel(device)].filter(Boolean).join(' ').toLowerCase().includes(term));
  }, [devices, search, tab]);

  const selected = selectedId ? devices.find((device) => device.id === selectedId) ?? null : null;
  const selectedEvidence = selected ? evidence(selected) : null;
  const metrics = useMemo(() => {
    const identity = devices.filter((device) => evidence(device).identity).length;
    const firmware = devices.filter((device) => evidence(device).firmware).length;
    const cellular = devices.filter((device) => evidence(device).cellular).length;
    const configAck = devices.filter((device) => evidence(device).config).length;
    const needsReview = devices.filter((device) => evidence(device).completed < evidence(device).total).length;
    return { total: devices.length, identity, firmware, cellular, configAck, needsReview };
  }, [devices]);

  const firmwareGroups = useMemo(() => {
    const map = new Map<string, number>();
    devices.forEach((device) => map.set(device.firmware_version ?? 'Unknown', (map.get(device.firmware_version ?? 'Unknown') ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [devices]);

  return (
    <section className={styles.workspace} data-factory-workspace="v1">
      <header className={styles.header}>
        <div><span>Administration</span><h1>Factory</h1><p>Factory readiness and controller evidence using the telemetry data currently available in production.</p></div>
        <div className={styles.headerActions}>
          <Link href="/telemetry/devices">Device Management</Link>
          <button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading factory device evidence" /> : <>
        <section className={styles.metrics}>
          <article><span>Total devices</span><strong>{metrics.total}</strong><small>Controllers in production store</small></article>
          <article><span>UID identified</span><strong>{metrics.identity}</strong><small>Hardware identity recorded</small></article>
          <article><span>Firmware known</span><strong>{metrics.firmware}</strong><small>Version reported</small></article>
          <article><span>Cellular observed</span><strong>{metrics.cellular}</strong><small>Cellular evidence recorded</small></article>
          <article><span>Config acknowledged</span><strong>{metrics.configAck}</strong><small>Latest config ACK recorded</small></article>
          <article className={metrics.needsReview ? styles.metricWarning : ''}><span>Needs review</span><strong>{metrics.needsReview}</strong><small>Incomplete operational evidence</small></article>
        </section>

        <nav className={styles.tabs} aria-label="Factory sections">
          {tabs.map((item) => <button aria-selected={tab === item.id} className={tab === item.id ? styles.activeTab : ''} key={item.id} onClick={() => setTab(item.id)} type="button">{item.label}</button>)}
        </nav>

        {tab === 'qa' || tab === 'batches' ? <section className={styles.backendNotice}>
          <div><span>{tab === 'qa' ? 'Final QA' : 'Factory batches'}</span><h2>{tab === 'qa' ? 'QA records are not yet persisted' : 'Batch lifecycle is not yet persisted'}</h2><p>{tab === 'qa' ? 'The current production schema does not contain dedicated factory QA stages, test measurements, waivers, rework or quarantine records.' : 'The current production schema does not contain factory batch records, operator stages, batch yield or batch disposition.'}</p></div>
          <strong>No simulated pass/fail data is shown.</strong>
        </section> : null}

        {tab !== 'qa' && tab !== 'batches' ? <>
          <section className={styles.toolbar}>
            <label><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Device, UID, firmware, operator or readiness" /></label>
            <span>{filtered.length} matching · updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
          </section>

          {tab === 'firmware' ? <section className={styles.firmwareSummary}>
            {firmwareGroups.map(([version, count]) => <article key={version}><span>{version}</span><strong>{count}</strong><small>devices</small></article>)}
          </section> : null}

          <section className={styles.tableCard}>
            <header><div><strong>{tab === 'devices' ? 'Factory device evidence' : tab === 'provisioning' ? 'Provisioning evidence pending' : tab === 'testing' ? 'Testing evidence pending' : 'Firmware distribution'}</strong><small>These stages are derived only from existing controller telemetry; they are not formal QA pass/fail records.</small></div></header>
            <div className={styles.tableScroll}><table><thead><tr><th>Device</th><th>UID</th><th>Firmware</th><th>Communication</th><th>Network</th><th>Config</th><th>Progress</th><th /></tr></thead><tbody>
              {filtered.map((device) => {
                const check = evidence(device);
                const health = deviceConnectionState(device);
                const config = deviceConfigSyncState(device);
                return <tr key={device.id}>
                  <td><strong>{device.device_code}</strong><small>{readinessLabel(device)}</small></td>
                  <td>{device.hardware_uid ?? 'Pending'}</td>
                  <td>{device.firmware_version ?? 'Unknown'}</td>
                  <td><strong>{health.label}</strong><small>{dateTime(health.contactAt)}</small></td>
                  <td><strong>{device.last_transport === 'wifi' ? 'Wi-Fi' : device.last_transport === 'cellular' ? 'Cellular' : 'Not observed'}</strong><small>{device.cellular_operator ?? ''}</small></td>
                  <td>{config.label}</td>
                  <td><div className={styles.progress}><i style={{ width: `${(check.completed / check.total) * 100}%` }} /><span>{check.completed}/{check.total}</span></div></td>
                  <td><button onClick={() => setSelectedId(device.id)} type="button">Review</button></td>
                </tr>;
              })}
            </tbody></table></div>
            {!filtered.length ? <div className={styles.empty}>No devices match this factory view.</div> : null}
          </section>
        </> : null}

        {selected && selectedEvidence ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedId(null); }} role="presentation">
          <aside className={styles.drawer} aria-label="Factory device evidence">
            <header><div><span>Factory device evidence</span><h2>{selected.device_code}</h2><p>{selected.hardware_uid ?? 'Hardware UID not reported'}</p></div><button onClick={() => setSelectedId(null)} type="button">×</button></header>
            <section className={styles.drawerProgress}><div><span>Operational evidence</span><strong>{selectedEvidence.completed}/{selectedEvidence.total}</strong></div><div className={styles.progress}><i style={{ width: `${(selectedEvidence.completed / selectedEvidence.total) * 100}%` }} /></div></section>
            <section className={styles.stageList}>
              {[
                ['Hardware identity', selectedEvidence.identity, selected.hardware_uid ?? 'UID not reported'],
                ['Firmware reported', selectedEvidence.firmware, selected.firmware_version ?? 'Version not reported'],
                ['Device communication', selectedEvidence.communication, dateTime(selected.last_heartbeat_at ?? selected.last_seen_at)],
                ['Network observed', selectedEvidence.network, selected.last_transport ?? 'No successful transport recorded'],
                ['Configuration ACK', selectedEvidence.config, dateTime(selected.last_config_ack_at)],
              ].map(([label, passed, detail]) => <article key={String(label)}><span className={passed ? styles.stageOk : styles.stagePending}>{passed ? '✓' : '•'}</span><div><strong>{label}</strong><small>{detail}</small></div></article>)}
            </section>
            <section className={styles.qaNotice}><strong>Formal QA not recorded</strong><p>Power, MDB/DEX, cellular, Wi-Fi, rework, waiver and final-QA measurements require a dedicated factory data model before they can be represented as test results.</p></section>
            <footer><Link href={`/telemetry/devices?device=${encodeURIComponent(selected.device_code)}`}>Open device</Link><Link href={`/telemetry/test-center?device=${encodeURIComponent(selected.device_code)}`}>Run Test Center</Link></footer>
          </aside>
        </div> : null}
      </>}
    </section>
  );
}
