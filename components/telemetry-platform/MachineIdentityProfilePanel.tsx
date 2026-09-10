'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineIdentityProfilePanel.module.css';

type ProfileOption = {
  id: string;
  model_key: string;
  display_name: string;
  button_count: number;
  updated_at: string | null;
};

type Conflict = {
  type: string;
  label: string;
  database_value: string | null;
  detected_value: string | null;
};

type Evidence = { type: string; value: string };

type IdentityState = {
  machine: {
    id: string;
    name: string | null;
    model: string | null;
    manufacturer: string | null;
    serial_number: string | null;
    asset_tag: string | null;
    barcode: string | null;
  };
  device: null | {
    id: string;
    device_code: string;
    reported_serial: string | null;
    reported_model: string | null;
    reported_revision: string | null;
    reported_asset: string | null;
    identity_source: string | null;
    profile_fingerprint: string | null;
    protocol: string | null;
    identity_at: string | null;
    machine_link_status: string | null;
    machine_link_method: string | null;
    profile_id: string | null;
    profile_assignment_method: 'automatic' | 'manual';
    profile_updated_at: string | null;
    last_config_ack_at: string | null;
    applied_profile_id: string | null;
  };
  profile_options: ProfileOption[];
  recommended_profile: null | (ProfileOption & { score: number; reason: string });
  effective_profile_key: string | null;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  conflicts: Conflict[];
  evidence: Evidence[];
  profile_pending: boolean;
};

function titleCase(value: string | null | undefined) {
  if (!value) return 'Unknown';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not reported';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function MachineIdentityProfilePanel({ machineId }: { machineId: string }) {
  const [identity, setIdentity] = useState<IdentityState | null>(null);
  const [assignmentMethod, setAssignmentMethod] = useState<'automatic' | 'manual'>('automatic');
  const [selectedProfile, setSelectedProfile] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const { data, error: identityError } = await client.rpc('get_telemetry_machine_identity', {
        p_machine_id: machineId,
      });
      if (identityError) throw identityError;
      const next = data as IdentityState;
      setIdentity(next);
      const method = next.device?.profile_assignment_method ?? 'automatic';
      setAssignmentMethod(method);
      setSelectedProfile(method === 'manual'
        ? next.device?.profile_id ?? ''
        : next.recommended_profile?.model_key ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load machine identification.');
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => { void load(); }, [load]);

  const effectiveProfile = useMemo(() => {
    if (!identity?.effective_profile_key) return null;
    return identity.profile_options.find((profile) => profile.model_key === identity.effective_profile_key) ?? null;
  }, [identity]);

  const save = async () => {
    if (!identity?.device) return;
    if (assignmentMethod === 'manual' && !selectedProfile) {
      setError('Choose a decoder profile before saving a manual override.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const client = getSupabaseClient();
      const { error: saveError } = await client.rpc('set_telemetry_device_profile', {
        p_device_id: identity.device.id,
        p_profile_key: assignmentMethod === 'manual' ? selectedProfile : null,
        p_assignment_method: assignmentMethod,
      });
      if (saveError) throw saveError;
      setNotice(assignmentMethod === 'manual'
        ? 'Manual decoder profile saved. The device will receive it on its next configuration sync.'
        : 'Automatic profile selection enabled. The best matching profile will be resolved from machine evidence.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save decoder profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !identity) {
    return <article className={styles.panel} data-machine-identification="loading"><div className={styles.loading}>Loading machine identification…</div></article>;
  }

  if (error && !identity) {
    return <article className={styles.panel} data-machine-identification="error"><div className={styles.error} role="alert">{error}</div></article>;
  }

  if (!identity?.device) {
    return (
      <article className={styles.panel} data-machine-identification="no-device">
        <header className={styles.header}>
          <div><span>Machine identification</span><h2>Detection & decoder profile</h2></div>
          <span className={`${styles.badge} ${styles.unknown}`}>No device</span>
        </header>
        <div className={styles.empty}>Assign an active telemetry device before machine detection or decoder profile management is available.</div>
      </article>
    );
  }

  const device = identity.device;
  const conflicts = identity.conflicts ?? [];
  const evidence = identity.evidence ?? [];
  const recommendation = identity.recommended_profile;
  const protocol = device.protocol ? device.protocol.toUpperCase() : 'Unknown';

  return (
    <article className={styles.panel} data-machine-identification="ready">
      <header className={styles.header}>
        <div>
          <span>Machine identification</span>
          <h2>Detection & decoder profile</h2>
          <p>{device.device_code} · evidence last observed {formatDate(device.identity_at)}</p>
        </div>
        <div className={styles.headerBadges}>
          <span className={`${styles.badge} ${styles[identity.confidence]}`}>{titleCase(identity.confidence)} confidence</span>
          <span className={`${styles.badge} ${conflicts.length ? styles.conflict : styles.clear}`}>{conflicts.length ? `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}` : 'Identity clear'}</span>
        </div>
      </header>

      <section className={styles.summaryGrid}>
        <div className={styles.summaryItem}><span>Detected protocol</span><strong>{protocol}</strong><small>{device.identity_source ? `Source: ${titleCase(device.identity_source)}` : 'Awaiting protocol evidence'}</small></div>
        <div className={styles.summaryItem}><span>Effective profile</span><strong>{effectiveProfile?.display_name ?? identity.effective_profile_key ?? 'No matching profile'}</strong><small>{device.profile_assignment_method === 'manual' ? 'Manual override' : recommendation ? 'Automatic recommendation' : 'Automatic · unmatched'}</small></div>
        <div className={styles.summaryItem}><span>Machine link</span><strong>{titleCase(device.machine_link_status)}</strong><small>{device.machine_link_method ? titleCase(device.machine_link_method) : 'No automatic link method recorded'}</small></div>
        <div className={styles.summaryItem}><span>Configuration</span><strong>{identity.profile_pending ? 'Pending device sync' : 'Applied'}</strong><small>{identity.profile_pending ? `Applied: ${device.applied_profile_id ?? 'none'}` : `ACK ${formatDate(device.last_config_ack_at)}`}</small></div>
      </section>

      {conflicts.length ? (
        <section className={styles.conflicts} aria-label="Machine identity conflicts">
          <h3>Identity requires attention</h3>
          {conflicts.map((conflict) => (
            <div className={styles.conflictRow} key={`${conflict.type}-${conflict.label}`}>
              <strong>{conflict.label}</strong>
              <span>Database: {conflict.database_value ?? 'not recorded'}</span>
              <span>Detected: {conflict.detected_value ?? 'not reported'}</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className={styles.compareGrid}>
        <div className={styles.identityColumn}>
          <h3>Database machine</h3>
          <dl>
            <div><dt>Model</dt><dd>{identity.machine.model ?? identity.machine.name ?? 'Not recorded'}</dd></div>
            <div><dt>Manufacturer</dt><dd>{identity.machine.manufacturer ?? 'Not recorded'}</dd></div>
            <div><dt>Serial</dt><dd>{identity.machine.serial_number ?? 'Not recorded'}</dd></div>
            <div><dt>Asset / QR</dt><dd>{identity.machine.asset_tag ?? identity.machine.barcode ?? 'Not recorded'}</dd></div>
          </dl>
        </div>
        <div className={styles.identityColumn}>
          <h3>Device evidence</h3>
          <dl>
            <div><dt>Model</dt><dd>{device.reported_model ?? 'Not reported'}</dd></div>
            <div><dt>Revision</dt><dd>{device.reported_revision ?? 'Not reported'}</dd></div>
            <div><dt>Serial</dt><dd>{device.reported_serial ?? 'Not reported'}</dd></div>
            <div><dt>Asset</dt><dd>{device.reported_asset ?? 'Not reported'}</dd></div>
            <div><dt>Fingerprint</dt><dd className={styles.mono}>{device.profile_fingerprint ?? 'Not reported'}</dd></div>
          </dl>
        </div>
      </section>

      {evidence.length ? <div className={styles.evidence}>{evidence.map((item) => <span key={`${item.type}-${item.value}`}><b>{titleCase(item.type)}</b>{item.value}</span>)}</div> : null}

      <section className={styles.profileEditor}>
        <div className={styles.profileIntro}>
          <span>Decoder profile assignment</span>
          <h3>{assignmentMethod === 'automatic' ? 'Automatic selection' : 'Manual override'}</h3>
          <p>{assignmentMethod === 'automatic'
            ? recommendation?.reason ?? 'No current machine profile matches the available model evidence. You can create a profile in Products or apply a manual override.'
            : 'The selected profile overrides automatic matching until Automatic is enabled again.'}</p>
          {recommendation ? <small>Recommended: <strong>{recommendation.display_name}</strong> · score {recommendation.score}/100 · {recommendation.button_count} buttons</small> : null}
        </div>

        <div className={styles.controls}>
          <label>
            Assignment
            <select value={assignmentMethod} onChange={(event) => setAssignmentMethod(event.target.value as 'automatic' | 'manual')}>
              <option value="automatic">Automatic</option>
              <option value="manual">Manual override</option>
            </select>
          </label>
          <label>
            Decoder profile
            <select disabled={assignmentMethod === 'automatic'} value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)}>
              <option value="">{recommendation ? `Recommended · ${recommendation.display_name}` : 'Choose profile'}</option>
              {identity.profile_options.map((profile) => <option key={profile.id} value={profile.model_key}>{profile.display_name} · {profile.button_count} buttons</option>)}
            </select>
          </label>
          <button className={styles.save} disabled={saving || (assignmentMethod === 'manual' && !selectedProfile)} onClick={() => void save()} type="button">{saving ? 'Saving…' : 'Save profile assignment'}</button>
        </div>
      </section>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <footer className={styles.actions}>
        <Link href="/products">Manage machine profiles & product mappings</Link>
        <Link href={`/telemetry/test-center?device=${encodeURIComponent(device.device_code)}`}>Open this device in Test Center</Link>
      </footer>
    </article>
  );
}
