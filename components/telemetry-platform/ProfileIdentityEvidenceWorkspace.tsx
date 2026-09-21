'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import { collectSupabasePagesResult } from '@/lib/supabase/collect-pages';
import styles from './ProfileIdentityEvidenceWorkspace.module.css';

type IdentityDevice = {
  id: string;
  device_code: string;
  machine_id: string | null;
  reported_machine_profile_fingerprint: string | null;
  reported_machine_model: string | null;
  reported_machine_interface: string | null;
  reported_machine_revision: string | null;
  reported_machine_identity_at: string | null;
  last_seen_at: string | null;
};

type DecoderProfile = {
  id: string;
  model_key: string;
  display_name: string;
  button_count: number;
};

type VerifiedMatch = {
  id: string;
  evidence_type: 'fingerprint' | 'model_alias';
  evidence_value: string;
  verified: boolean;
  profile_key: string;
  profile_name: string;
  source_device_id: string | null;
  source_telemetry_region: string | null;
  verified_at: string | null;
};

type CandidatePayload = {
  device_id: string;
  device_code: string;
  telemetry_region: string;
  machine_id: string | null;
  machine_name: string | null;
  machine_model: string | null;
  can_verify: boolean;
  observations: {
    fingerprint: string | null;
    model: string | null;
    interface: string | null;
    revision: string | null;
    identity_source: string | null;
    identity_at: string | null;
  };
  resolution: {
    profile_assignment_method?: string;
    profile_resolution?: string;
    effective_profile_key?: string | null;
    confidence?: string;
    candidate_gap?: number | null;
    ambiguous?: boolean;
    recommended_profile?: { model_key?: string; display_name?: string; score?: number; reason?: string } | null;
  };
  profiles: DecoderProfile[];
  verified_matches: VerifiedMatch[];
};

const DEVICE_SELECT = 'id,device_code,machine_id,reported_machine_profile_fingerprint,reported_machine_model,reported_machine_interface,reported_machine_revision,reported_machine_identity_at,last_seen_at';
const PAGE_SIZE = 500;

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not reported';
  return new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function compact(value: string | null | undefined, max = 42) {
  if (!value) return '—';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function ProfileIdentityEvidenceWorkspace() {
  const [devices, setDevices] = useState<IdentityDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CandidatePayload | null>(null);
  const [search, setSearch] = useState('');
  const [profileKey, setProfileKey] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [savingType, setSavingType] = useState<'fingerprint' | 'model_alias' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestedDeviceHandled = useRef(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const result = await collectSupabasePagesResult<IdentityDevice>(async (from, to) => {
      const { data, error: pageError } = await client
        .from('telemetry_devices')
        .select(DEVICE_SELECT)
        .or('reported_machine_profile_fingerprint.not.is.null,reported_machine_model.not.is.null')
        .order('device_code', { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as IdentityDevice[], error: pageError };
    }, PAGE_SIZE);

    if (result.error) {
      setError(result.error.message);
      setDevices([]);
    } else {
      const rows = result.data.filter((row) => Boolean(row.reported_machine_profile_fingerprint?.trim() || row.reported_machine_model?.trim()));
      setDevices(rows);
      setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : null);
    }
    setLoading(false);
  }, []);

  const loadCandidate = useCallback(async (deviceId: string) => {
    setCandidateLoading(true);
    setError(null);
    const { data, error: candidateError } = await getSupabaseClient().rpc('get_telemetry_profile_identity_candidate', { p_device_id: deviceId });
    if (candidateError) {
      setCandidate(null);
      setError(candidateError.message);
      setCandidateLoading(false);
      return;
    }
    const next = (data ?? null) as CandidatePayload | null;
    setCandidate(next);
    const recommended = next?.resolution?.effective_profile_key
      ?? next?.resolution?.recommended_profile?.model_key
      ?? next?.profiles?.[0]?.model_key
      ?? '';
    setProfileKey(recommended);
    setCandidateLoading(false);
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  useEffect(() => {
    if (requestedDeviceHandled.current || !devices.length) return;
    requestedDeviceHandled.current = true;
    const requested = new URLSearchParams(window.location.search).get('device')?.trim();
    const requestedDevice = requested ? devices.find((row) => row.device_code === requested) : null;
    if (requestedDevice) setSelectedId(requestedDevice.id);
  }, [devices]);

  useEffect(() => {
    setMessage(null);
    setNotes('');
    if (!selectedId) {
      setCandidate(null);
      return;
    }
    void loadCandidate(selectedId);
  }, [loadCandidate, selectedId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return devices;
    return devices.filter((device) => [
      device.device_code,
      device.reported_machine_model,
      device.reported_machine_interface,
      device.reported_machine_profile_fingerprint,
    ].join(' ').toLowerCase().includes(term));
  }, [devices, search]);

  const selected = selectedId ? devices.find((row) => row.id === selectedId) ?? null : null;

  async function verifyEvidence(event: FormEvent, evidenceType: 'fingerprint' | 'model_alias') {
    event.preventDefault();
    if (!selected || !candidate || !profileKey) return;
    setSavingType(evidenceType);
    setError(null);
    setMessage(null);
    const { data, error: verifyError } = await getSupabaseClient().rpc('verify_telemetry_profile_identity_evidence', {
      p_device_id: selected.id,
      p_profile_key: profileKey,
      p_evidence_type: evidenceType,
      p_notes: notes.trim() || null,
    });
    setSavingType(null);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    const result = (data ?? {}) as { profile_name?: string; evidence_type?: string };
    setMessage(`${result.evidence_type === 'model_alias' ? 'Model alias' : 'Fingerprint'} verified for ${result.profile_name ?? profileKey}. Future automatic profile resolution can reuse this evidence.`);
    await loadCandidate(selected.id);
  }

  return (
    <section className={styles.workspace} data-profile-identity-evidence="v1">
      {error ? <div className={styles.error} role="alert"><strong>Profile identity error</strong><span>{error}</span></div> : null}
      {message ? <div className={styles.success} role="status"><strong>Verified</strong><span>{message}</span></div> : null}

      <header className={styles.header}>
        <div><span>Decoder learning</span><h2>Verified profile identity evidence</h2><p>Review identity observations reported by controllers and promote only field-confirmed fingerprints or machine-model aliases into reusable automatic decoder rules.</p></div>
        <button disabled={loading} onClick={() => void loadDevices()} type="button">Refresh candidates</button>
      </header>

      <div className={styles.securityNote}>
        <strong>Safe promotion path</strong>
        <span>Evidence values are taken from the selected controller’s reported identity state. They cannot be typed or substituted by the browser, and verification never changes the physical machine assignment.</span>
      </div>

      {loading ? <HamsterLoader label="Loading profile identity candidates" /> : (
        <div className={styles.layout}>
          <aside className={styles.list} aria-label="Identity candidates">
            <label className={styles.search}><span>Find candidate</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Device, model, interface or fingerprint" /></label>
            <div className={styles.listMeta}>{filtered.length.toLocaleString('en-ZA')} candidate{filtered.length === 1 ? '' : 's'} in your selected telemetry region</div>
            {filtered.length ? filtered.map((device) => (
              <button className={`${styles.deviceButton} ${selectedId === device.id ? styles.selected : ''}`} key={device.id} onClick={() => setSelectedId(device.id)} type="button">
                <strong>{device.device_code}</strong>
                <span>{device.reported_machine_model ?? 'Model not reported'}</span>
                <small>{device.reported_machine_interface?.toUpperCase() ?? 'Interface unknown'} · identity {formatDate(device.reported_machine_identity_at)}</small>
                <code title={device.reported_machine_profile_fingerprint ?? undefined}>{compact(device.reported_machine_profile_fingerprint)}</code>
              </button>
            )) : <div className={styles.empty}>No controller in this region has reported a stable fingerprint or machine model yet. Firmware V6.8.52 can provide the stable MDB profile fingerprint when the device reconnects.</div>}
          </aside>

          <section className={styles.detail} aria-live="polite">
            {!selected ? <div className={styles.emptyDetail}><strong>Select a candidate</strong><span>Choose a controller to inspect its observed identity and current automatic decoder resolution.</span></div> : candidateLoading ? <HamsterLoader label="Resolving decoder profile evidence" /> : candidate ? <>
              <header className={styles.detailHeader}><div><span>{candidate.telemetry_region.replaceAll('_', ' ')}</span><h3>{candidate.device_code}</h3><p>{candidate.machine_name ?? 'No linked machine name'}{candidate.machine_model ? ` · ${candidate.machine_model}` : ''}</p></div><div className={styles.resolution}><span>{candidate.resolution.profile_resolution ?? 'unresolved'}</span><strong>{candidate.resolution.effective_profile_key ?? 'No automatic profile'}</strong><small>{candidate.resolution.confidence ?? 'unknown'} confidence</small></div></header>

              <dl className={styles.observations}>
                <div><dt>Stable fingerprint</dt><dd><code>{candidate.observations.fingerprint ?? 'Not reported'}</code></dd></div>
                <div><dt>Reported model</dt><dd>{candidate.observations.model ?? 'Not reported'}</dd></div>
                <div><dt>Interface</dt><dd>{candidate.observations.interface?.toUpperCase() ?? 'Not reported'}</dd></div>
                <div><dt>Revision</dt><dd>{candidate.observations.revision ?? 'Not reported'}</dd></div>
                <div><dt>Identity source</dt><dd>{candidate.observations.identity_source ?? 'Not reported'}</dd></div>
                <div><dt>Observed</dt><dd>{formatDate(candidate.observations.identity_at)}</dd></div>
              </dl>

              {candidate.verified_matches.length ? <section className={styles.matches}><h4>Existing verified matches</h4>{candidate.verified_matches.map((match) => <div key={match.id}><strong>{match.evidence_type === 'model_alias' ? 'Model alias' : 'Fingerprint'} → {match.profile_name}</strong><code>{match.evidence_value}</code><small>{match.verified ? 'Verified' : 'Unverified'} · {formatDate(match.verified_at)}</small></div>)}</section> : null}

              <form className={styles.verifyForm} onSubmit={(event) => event.preventDefault()}>
                <label><span>Decoder profile</span><select value={profileKey} onChange={(event) => setProfileKey(event.target.value)}>{candidate.profiles.map((profile) => <option key={profile.id} value={profile.model_key}>{profile.display_name}</option>)}</select></label>
                <label><span>Verification note</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional field-test or machine reference" rows={3} /></label>
                {candidate.can_verify ? <div className={styles.verifyActions}>
                  <button disabled={!candidate.observations.fingerprint || Boolean(savingType)} onClick={(event) => void verifyEvidence(event, 'fingerprint')} type="button">{savingType === 'fingerprint' ? 'Verifying…' : 'Verify fingerprint'}</button>
                  <button disabled={!candidate.observations.model || Boolean(savingType)} onClick={(event) => void verifyEvidence(event, 'model_alias')} type="button">{savingType === 'model_alias' ? 'Verifying…' : 'Verify reported model alias'}</button>
                </div> : <div className={styles.readOnly}><strong>Administrator verification required</strong><span>You can inspect regional identity candidates, but only an administrator can promote globally trusted decoder evidence.</span></div>}
              </form>
            </> : <div className={styles.emptyDetail}>Candidate details are unavailable.</div>}
          </section>
        </div>
      )}
    </section>
  );
}
