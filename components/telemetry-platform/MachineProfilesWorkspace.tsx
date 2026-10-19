'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineProfilesWorkspace.module.css';

type DrawerTab = 'config' | 'products' | 'commands' | 'errors' | 'devices';

type Profile = {
  id: string;
  model_key: string;
  display_name: string;
  button_count: number;
  created_at: string;
  updated_at: string;
};

type ButtonMapping = {
  id: string;
  profile_id: string;
  button_number: number;
  selection_code: string;
  product_id: string;
  products?: { product_name: string; is_active: boolean } | { product_name: string; is_active: boolean }[] | null;
};

type FaultRule = {
  id: string;
  profile_id: string;
  interface: string | null;
  raw_fault_code: string;
  canonical_fault_code: string;
  title: string;
  category: string | null;
  severity: string | null;
  recommended_action: string | null;
  evidence_source: string;
  is_verified: boolean;
  is_active: boolean;
};

type Device = {
  id: string;
  device_code: string;
  profile_id: string | null;
  profile_assignment_method: string | null;
  reported_machine_model: string | null;
  reported_machine_interface: string | null;
  firmware_version: string | null;
  last_config_ack_at: string | null;
  applied_config: Record<string, unknown> | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function dateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function appliedProfile(device: Device) {
  const value = device.applied_config?.profile_id;
  return typeof value === 'string' ? value : null;
}

export function MachineProfilesWorkspace() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [mappings, setMappings] = useState<ButtonMapping[]>([]);
  const [faultRules, setFaultRules] = useState<FaultRule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('config');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const [profileResult, mappingResult, faultResult, deviceResult] = await Promise.all([
        client.from('machine_model_profiles').select('id,model_key,display_name,button_count,created_at,updated_at').order('display_name'),
        client.from('machine_model_button_mappings').select('id,profile_id,button_number,selection_code,product_id,products(product_name,is_active)').order('button_number'),
        client.from('machine_model_fault_rules').select('id,profile_id,interface,raw_fault_code,canonical_fault_code,title,category,severity,recommended_action,evidence_source,is_verified,is_active').order('raw_fault_code'),
        client.from('telemetry_devices').select('id,device_code,profile_id,profile_assignment_method,reported_machine_model,reported_machine_interface,firmware_version,last_config_ack_at,applied_config').neq('status', 'retired').limit(5000),
      ]);
      const firstError = profileResult.error ?? mappingResult.error ?? faultResult.error ?? deviceResult.error;
      if (firstError) throw firstError;
      setProfiles((profileResult.data ?? []) as Profile[]);
      setMappings((mappingResult.data ?? []) as ButtonMapping[]);
      setFaultRules((faultResult.data ?? []) as FaultRule[]);
      setDevices((deviceResult.data ?? []) as Device[]);
      setSelectedId((current) => current && (profileResult.data ?? []).some((profile) => profile.id === current) ? current : null);
      setUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load machine profiles.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = selectedId ? profiles.find((profile) => profile.id === selectedId) ?? null : null;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return profiles;
    return profiles.filter((profile) => [profile.display_name, profile.model_key].some((value) => value.toLowerCase().includes(term)));
  }, [profiles, search]);

  const profileStats = useMemo(() => profiles.map((profile) => {
    const profileMappings = mappings.filter((mapping) => mapping.profile_id === profile.id);
    const profileFaults = faultRules.filter((rule) => rule.profile_id === profile.id && rule.is_active);
    const profileDevices = devices.filter((device) => device.profile_id === profile.model_key || appliedProfile(device) === profile.model_key);
    const verifiedFaults = profileFaults.filter((rule) => rule.is_verified).length;
    const pendingDevices = profileDevices.filter((device) => appliedProfile(device) !== profile.model_key).length;
    return {
      profile,
      mappingCount: profileMappings.length,
      faultCount: profileFaults.length,
      verifiedFaults,
      deviceCount: profileDevices.length,
      pendingDevices,
    };
  }), [devices, faultRules, mappings, profiles]);

  const selectedStats = selected ? profileStats.find((item) => item.profile.id === selected.id) ?? null : null;
  const selectedMappings = selected ? mappings.filter((mapping) => mapping.profile_id === selected.id) : [];
  const selectedFaults = selected ? faultRules.filter((rule) => rule.profile_id === selected.id) : [];
  const selectedDevices = selected ? devices.filter((device) => device.profile_id === selected.model_key || appliedProfile(device) === selected.model_key) : [];

  const totalMapped = mappings.length;
  const verifiedFaultRules = faultRules.filter((rule) => rule.is_active && rule.is_verified).length;
  const profileDevices = devices.filter((device) => device.profile_id || appliedProfile(device)).length;
  const pendingConfig = devices.filter((device) => device.profile_id && appliedProfile(device) !== device.profile_id).length;

  return (
    <section className={styles.workspace} data-machine-profiles="v1">
      <header className={styles.header}>
        <div><span>Administration</span><h1>Machine Profiles</h1><p>Decoder profiles, product selections, verified fault rules, assigned devices and identity-rollout context.</p></div>
        <div className={styles.headerActions}>
          <Link href="/telemetry/devices/profile-identity">Identity Evidence</Link>
          <Link href="/telemetry/devices/profile-rollout">Profile Rollout</Link>
          <button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading machine profiles" /> : <>
        <section className={styles.metrics}>
          <article><span>Profiles</span><strong>{profiles.length}</strong><small>Current decoder definitions</small></article>
          <article><span>Product mappings</span><strong>{totalMapped}</strong><small>Button / selection mappings</small></article>
          <article><span>Verified fault rules</span><strong>{verifiedFaultRules}</strong><small>Profile-specific normalized errors</small></article>
          <article><span>Profile devices</span><strong>{profileDevices}</strong><small>Assigned or applied profiles</small></article>
          <article className={pendingConfig ? styles.metricWarning : ''}><span>Config pending</span><strong>{pendingConfig}</strong><small>Assigned profile not yet applied</small></article>
        </section>

        <section className={styles.toolbar}>
          <label><span>Search profiles</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model key or profile name" /></label>
          <div><span>Lifecycle</span><strong>Current schema has no Draft/Test/Approved/Production/Retired field</strong></div>
          <small>{filtered.length} profiles · updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</small>
        </section>

        <section className={styles.tableCard}>
          <header><div><strong>Decoder profile register</strong><small>Operational records currently stored in machine_model_profiles.</small></div><span>{filtered.length}</span></header>
          <div className={styles.tableScroll}>
            <table>
              <thead><tr><th>Profile</th><th>Selections</th><th>Mapped products</th><th>Fault rules</th><th>Devices</th><th>Config state</th><th>Updated</th><th /></tr></thead>
              <tbody>{filtered.map((profile) => {
                const stat = profileStats.find((item) => item.profile.id === profile.id)!;
                return <tr key={profile.id}>
                  <td><strong>{profile.display_name}</strong><small>{profile.model_key}</small></td>
                  <td>{profile.button_count}</td>
                  <td><strong>{stat.mappingCount}</strong><small>{Math.max(0, profile.button_count - stat.mappingCount)} unmapped slots</small></td>
                  <td><strong>{stat.verifiedFaults}</strong><small>{stat.faultCount} active rules</small></td>
                  <td>{stat.deviceCount}</td>
                  <td>{stat.pendingDevices ? <span className={styles.pending}>{stat.pendingDevices} pending</span> : <span className={styles.ready}>Synced</span>}</td>
                  <td>{dateTime(profile.updated_at)}</td>
                  <td><button onClick={() => { setSelectedId(profile.id); setDrawerTab('config'); }} type="button">Open</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {!filtered.length ? <div className={styles.empty}>No machine profiles match this search.</div> : null}
        </section>

        {selected && selectedStats ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedId(null); }} role="presentation">
          <aside className={styles.drawer} aria-label="Machine profile details">
            <header>
              <div><span>Machine profile</span><h2>{selected.display_name}</h2><p>{selected.model_key}</p></div>
              <button aria-label="Close profile details" onClick={() => setSelectedId(null)} type="button">×</button>
            </header>

            <section className={styles.drawerSummary}>
              <div><span>Selections</span><strong>{selected.button_count}</strong></div>
              <div><span>Products</span><strong>{selectedStats.mappingCount}</strong></div>
              <div><span>Fault rules</span><strong>{selectedStats.verifiedFaults}</strong></div>
              <div><span>Devices</span><strong>{selectedStats.deviceCount}</strong></div>
            </section>

            <nav className={styles.drawerTabs}>
              {([
                ['config', 'Config'],
                ['products', 'Products'],
                ['commands', 'Commands'],
                ['errors', 'Errors'],
                ['devices', 'Devices'],
              ] as Array<[DrawerTab,string]>).map(([id,label]) => <button aria-selected={drawerTab === id} className={drawerTab === id ? styles.activeDrawerTab : ''} key={id} onClick={() => setDrawerTab(id)} type="button">{label}</button>)}
            </nav>

            <section className={styles.drawerBody}>
              {drawerTab === 'config' ? <>
                <dl className={styles.facts}>
                  <div><dt>Model key</dt><dd>{selected.model_key}</dd></div>
                  <div><dt>Display name</dt><dd>{selected.display_name}</dd></div>
                  <div><dt>Selection count</dt><dd>{selected.button_count}</dd></div>
                  <div><dt>Created</dt><dd>{dateTime(selected.created_at)}</dd></div>
                  <div><dt>Updated</dt><dd>{dateTime(selected.updated_at)}</dd></div>
                </dl>
                <div className={styles.infoBox}><strong>Lifecycle status unavailable</strong><p>The approved profile lifecycle (Draft → Test → Approved → Production → Retired) is not stored in the current profile schema, so this workspace does not fabricate one.</p></div>
              </> : null}

              {drawerTab === 'products' ? <div className={styles.itemList}>
                {selectedMappings.map((mapping) => {
                  const product = firstRelation(mapping.products);
                  return <article key={mapping.id}><div><strong>Button {mapping.button_number}</strong><span>{product?.product_name ?? 'Product missing'}</span></div><div><b>{mapping.selection_code}</b><small>{product?.is_active === false ? 'Inactive product' : 'Active product'}</small></div></article>;
                })}
                {!selectedMappings.length ? <div className={styles.emptyInner}>No product selections are mapped to this profile.</div> : null}
              </div> : null}

              {drawerTab === 'commands' ? <div className={styles.infoBox}><strong>No profile command-definition model exists yet</strong><p>MDB/DEX command templates and capability commands are not persisted as profile-owned records in the current production schema. They should be added only with an explicit command/version model and device compatibility checks.</p></div> : null}

              {drawerTab === 'errors' ? <div className={styles.itemList}>
                {selectedFaults.map((rule) => <article key={rule.id}><div><strong>{rule.raw_fault_code} → {rule.canonical_fault_code}</strong><span>{rule.title}</span></div><div><b>{rule.severity ?? 'Unrated'}</b><small>{rule.is_verified ? 'Verified' : 'Unverified'} · {rule.interface ?? 'any'}</small></div>{rule.recommended_action ? <p>{rule.recommended_action}</p> : null}</article>)}
                {!selectedFaults.length ? <div className={styles.emptyInner}>No profile-specific fault rules are configured.</div> : null}
              </div> : null}

              {drawerTab === 'devices' ? <div className={styles.itemList}>
                {selectedDevices.map((device) => <article key={device.id}><div><strong>{device.device_code}</strong><span>{device.reported_machine_model ?? 'Machine model not reported'} · {device.firmware_version ?? 'Firmware unknown'}</span></div><div><b>{device.profile_assignment_method ?? 'automatic'}</b><small>{appliedProfile(device) === selected.model_key ? 'Applied' : 'Pending apply'} · {device.reported_machine_interface?.toUpperCase() ?? 'interface unknown'}</small></div></article>)}
                {!selectedDevices.length ? <div className={styles.emptyInner}>No active devices currently reference this profile.</div> : null}
              </div> : null}
            </section>

            <footer>
              <Link href="/telemetry/devices/profile-identity">Identity evidence</Link>
              <Link href="/telemetry/devices/profile-rollout">Rollout queue</Link>
              <Link href="/products">Product mappings</Link>
            </footer>
          </aside>
        </div> : null}
      </>}
    </section>
  );
}
