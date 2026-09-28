'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './ProfileIdentityEvidenceWorkspace.module.css';

type ReviewQueueFilter = 'needs_review' | 'ambiguous' | 'recommended' | 'unresolved' | 'all';
type ReviewClass = 'ambiguous' | 'recommended' | 'unresolved' | 'trusted';

type IdentityDevice = {
  id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  machine_model: string | null;
  profile_id: string | null;
  profile_assignment_method: 'automatic' | 'manual' | null;
  reported_machine_profile_fingerprint: string | null;
  reported_machine_model: string | null;
  reported_machine_interface: string | null;
  reported_machine_revision: string | null;
  reported_machine_identity_source: string | null;
  reported_machine_identity_at: string | null;
  last_seen_at: string | null;
  review_class: ReviewClass;
  recommended_profile_key: string | null;
  recommended_profile_name: string | null;
  profile_confidence: string | null;
  resolver_ambiguous: boolean;
};

type ReviewQueueSummary = {
  all_candidates: number;
  needs_review: number;
  ambiguous: number;
  recommended: number;
  unresolved: number;
  trusted_manual: number;
  trusted_automatic: number;
};

type ReviewQueuePayload = {
  telemetry_region: string;
  rows: IdentityDevice[];
  total: number;
  summary: ReviewQueueSummary;
  limit: number;
  offset: number;
  generated_at: string;
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
  notes: string | null;
  source_device_id: string | null;
  source_device_code: string | null;
  source_telemetry_region: string | null;
  verified_by_name: string | null;
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

const PAGE_SIZE = 100;
const QUEUE_PRIORITY = { ambiguous: 0, recommended: 1, unresolved: 2, trusted: 3 } as const;
const EMPTY_SUMMARY: ReviewQueueSummary = {
  all_candidates: 0,
  needs_review: 0,
  ambiguous: 0,
  recommended: 0,
  unresolved: 0,
  trusted_manual: 0,
  trusted_automatic: 0,
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not reported';
  return new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function compact(value: string | null | undefined, max = 42) {
  if (!value) return '—';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function humanizeRegion(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ') : 'Region not recorded';
}

function queueLabel(device: IdentityDevice) {
  if (device.profile_assignment_method === 'manual') return 'Manual override';
  if (device.profile_id) return `Verified automatic · ${device.profile_id}`;
  if (device.review_class === 'ambiguous') return 'Ambiguous · review first';
  if (device.review_class === 'recommended') return `Recommended · ${device.recommended_profile_key ?? 'profile available'}`;
  return 'Unresolved · no trusted match';
}

function reviewStatus(device: IdentityDevice, candidate: CandidatePayload | null) {
  if (device.profile_assignment_method === 'manual') {
    return {
      label: 'Manual override',
      value: device.profile_id ?? 'Manual profile missing',
      detail: 'Manual assignment is authoritative and is never replaced by automatic identity evidence.',
    };
  }
  if (device.profile_id) {
    return {
      label: 'Verified automatic',
      value: device.profile_id,
      detail: 'This profile is persisted on the device from uniquely verified identity evidence.',
    };
  }
  if (device.review_class === 'ambiguous' || candidate?.resolution?.ambiguous) {
    return {
      label: 'Ambiguous',
      value: 'No persisted profile',
      detail: 'Multiple candidates are too close to trust. Review the reported identity before verifying evidence.',
    };
  }
  const advisory = device.recommended_profile_key
    ?? candidate?.resolution?.recommended_profile?.model_key
    ?? candidate?.resolution?.effective_profile_key
    ?? null;
  return {
    label: 'Unverified',
    value: advisory ? `Advisory: ${advisory}` : 'No persisted profile',
    detail: advisory
      ? 'The resolver has an advisory recommendation, but it will not be persisted until identity evidence is verified.'
      : 'No uniquely verified decoder identity exists yet.',
  };
}

function QueueButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className={active ? styles.selected : undefined} onClick={onClick} type="button"><strong>{label}</strong><span>{count.toLocaleString('en-ZA')}</span></button>;
}

export function ProfileIdentityEvidenceWorkspace() {
  const [devices, setDevices] = useState<IdentityDevice[]>([]);
  const [queueSummary, setQueueSummary] = useState<ReviewQueueSummary>(EMPTY_SUMMARY);
  const [queueFilter, setQueueFilter] = useState<ReviewQueueFilter>('needs_review');
  const [queueRegion, setQueueRegion] = useState<string | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queuePage, setQueuePage] = useState(1);
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

  const loadDevices = useCallback(async (override?: { filter?: ReviewQueueFilter; search?: string; page?: number }) => {
    const effectiveFilter = override?.filter ?? queueFilter;
    const effectiveSearch = override?.search ?? search;
    const effectivePage = override?.page ?? queuePage;
    setLoading(true);
    setError(null);
    const { data, error: queueError } = await getSupabaseClient().rpc('get_telemetry_profile_identity_review_queue', {
      p_filter: effectiveFilter,
      p_search: effectiveSearch.trim(),
      p_offset: (effectivePage - 1) * PAGE_SIZE,
      p_limit: PAGE_SIZE,
    });

    if (queueError) {
      setError(queueError.message);
      setDevices([]);
      setQueueTotal(0);
      setLoading(false);
      return;
    }

    const payload = (data ?? null) as ReviewQueuePayload | null;
    const rows = [...(payload?.rows ?? [])].sort((left, right) => {
      const priority = QUEUE_PRIORITY[left.review_class] - QUEUE_PRIORITY[right.review_class];
      if (priority !== 0) return priority;
      return left.device_code.localeCompare(right.device_code);
    });
    setDevices(rows);
    setQueueSummary(payload?.summary ?? EMPTY_SUMMARY);
    setQueueRegion(payload?.telemetry_region ?? null);
    setQueueTotal(payload?.total ?? 0);
    setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : null);
    setLoading(false);
  }, [queueFilter, queuePage, search]);

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
    if (requestedDeviceHandled.current || loading) return;
    const requested = new URLSearchParams(window.location.search).get('device')?.trim();
    if (!requested) {
      requestedDeviceHandled.current = true;
      return;
    }
    const requestedDevice = devices.find((row) => row.device_code === requested);
    if (requestedDevice) {
      requestedDeviceHandled.current = true;
      setSelectedId(requestedDevice.id);
      return;
    }
    requestedDeviceHandled.current = true;
    setQueueFilter('all');
    setQueuePage(1);
    setSearch(requested);
  }, [devices, loading]);

  useEffect(() => {
    setMessage(null);
    setNotes('');
    if (!selectedId) {
      setCandidate(null);
      return;
    }
    void loadCandidate(selectedId);
  }, [loadCandidate, selectedId]);

  const selected = selectedId ? devices.find((row) => row.id === selectedId) ?? null : null;
  const selectedReviewStatus = selected ? reviewStatus(selected, candidate) : null;
  const pageCount = Math.max(1, Math.ceil(queueTotal / PAGE_SIZE));

  function applyQueueFilter(next: ReviewQueueFilter) {
    setQueueFilter(next);
    setQueuePage(1);
    setSelectedId(null);
    setCandidate(null);
  }

  async function verifyEvidence(evidenceType: 'fingerprint' | 'model_alias') {
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
    setQueueFilter('all');
    setQueuePage(1);
    setSearch(selected.device_code);
    await loadDevices({ filter: 'all', search: selected.device_code, page: 1 });
    await loadCandidate(selected.id);
    setMessage(`${result.evidence_type === 'model_alias' ? 'Model alias' : 'Fingerprint'} verified for ${result.profile_name ?? profileKey}. Persisted device state has been refreshed; automatic-mode devices now apply only uniquely verified evidence.`);
  }

  return (
    <section className={styles.workspace} data-profile-identity-evidence="v4">
      {error ? <div className={styles.error} role="alert"><strong>Profile identity error</strong><span>{error}</span></div> : null}
      {message ? <div className={styles.success} role="status"><strong>Verified</strong><span>{message}</span></div> : null}

      <header className={styles.header}>
        <div><span>Decoder learning</span><h2>Identity review queue</h2><p>Prioritize ambiguous controller identities first, then strong advisory matches, then devices with no recognizable decoder profile. Only verified evidence can become an automatic assignment.</p></div>
        <button disabled={loading} onClick={() => void loadDevices()} type="button">Refresh queue</button>
      </header>

      <div className={styles.securityNote}>
        <strong>Safe promotion path</strong>
        <span>Evidence values are taken from controller-reported identity state. Resolver matches remain advisory until verified, manual overrides remain authoritative, and verification never changes the physical machine assignment.</span>
      </div>

      <div className={styles.verifyActions} aria-label="Identity review queue filters">
        <QueueButton active={queueFilter === 'needs_review'} count={queueSummary.needs_review} label="Needs review" onClick={() => applyQueueFilter('needs_review')} />
        <QueueButton active={queueFilter === 'ambiguous'} count={queueSummary.ambiguous} label="Ambiguous" onClick={() => applyQueueFilter('ambiguous')} />
        <QueueButton active={queueFilter === 'recommended'} count={queueSummary.recommended} label="Recommended" onClick={() => applyQueueFilter('recommended')} />
        <QueueButton active={queueFilter === 'unresolved'} count={queueSummary.unresolved} label="Unresolved" onClick={() => applyQueueFilter('unresolved')} />
        <QueueButton active={queueFilter === 'all'} count={queueSummary.all_candidates} label="All candidates" onClick={() => applyQueueFilter('all')} />
      </div>

      {loading ? <HamsterLoader label="Loading prioritized profile identity queue" /> : (
        <div className={styles.layout}>
          <aside className={styles.list} aria-label="Identity review queue">
            <label className={styles.search}><span>Find candidate</span><input value={search} onChange={(event) => { setSearch(event.target.value); setQueuePage(1); }} placeholder="Device, machine, model, interface or fingerprint" /></label>
            <div className={styles.listMeta}>{queueTotal.toLocaleString('en-ZA')} matching · {humanizeRegion(queueRegion)} · page {queuePage.toLocaleString('en-ZA')} of {pageCount.toLocaleString('en-ZA')}</div>
            {devices.length ? devices.map((device) => (
              <button className={`${styles.deviceButton} ${selectedId === device.id ? styles.selected : ''}`} key={device.id} onClick={() => setSelectedId(device.id)} type="button">
                <strong>{device.device_code}</strong>
                <span>{device.reported_machine_model ?? device.machine_model ?? 'Model not reported'}</span>
                <small>{queueLabel(device)} · {device.reported_machine_interface?.toUpperCase() ?? 'Interface unknown'}</small>
                {device.review_class === 'recommended' ? <small>{device.recommended_profile_name ?? device.recommended_profile_key} · {device.profile_confidence ?? 'unknown'} confidence</small> : null}
                <code title={device.reported_machine_profile_fingerprint ?? undefined}>{compact(device.reported_machine_profile_fingerprint)}</code>
              </button>
            )) : <div className={styles.empty}>No controllers match this review state. The default queue excludes manual overrides and already verified automatic assignments.</div>}
            <div className={styles.verifyActions}>
              <button disabled={queuePage <= 1} onClick={() => setQueuePage((current) => Math.max(1, current - 1))} type="button">Previous</button>
              <button disabled={queuePage >= pageCount} onClick={() => setQueuePage((current) => Math.min(pageCount, current + 1))} type="button">Next</button>
            </div>
          </aside>

          <section className={styles.detail} aria-live="polite">
            {!selected ? <div className={styles.emptyDetail}><strong>Select a review item</strong><span>Choose a controller to inspect its observed identity, advisory resolver result and trusted evidence history.</span></div> : candidateLoading ? <HamsterLoader label="Resolving decoder profile evidence" /> : candidate ? <>
              <header className={styles.detailHeader}><div><span>{candidate.telemetry_region.replaceAll('_', ' ')}</span><h3>{candidate.device_code}</h3><p>{candidate.machine_name ?? 'No linked machine name'}{candidate.machine_model ? ` · ${candidate.machine_model}` : ''}</p></div><div className={styles.resolution}><span>{selectedReviewStatus?.label ?? 'Unverified'}</span><strong>{selectedReviewStatus?.value ?? 'No persisted profile'}</strong><small>{selectedReviewStatus?.detail ?? 'Identity review required.'}</small></div></header>

              <dl className={styles.observations}>
                <div><dt>Queue priority</dt><dd>{selected.review_class === 'trusted' ? 'Trusted / no review required' : selected.review_class}</dd></div>
                <div><dt>Advisory profile</dt><dd>{selected.recommended_profile_name ?? selected.recommended_profile_key ?? 'No recommendation'}</dd></div>
                <div><dt>Stable fingerprint</dt><dd><code>{candidate.observations.fingerprint ?? 'Not reported'}</code></dd></div>
                <div><dt>Reported model</dt><dd>{candidate.observations.model ?? 'Not reported'}</dd></div>
                <div><dt>Interface</dt><dd>{candidate.observations.interface?.toUpperCase() ?? 'Not reported'}</dd></div>
                <div><dt>Revision</dt><dd>{candidate.observations.revision ?? 'Not reported'}</dd></div>
                <div><dt>Identity source</dt><dd>{candidate.observations.identity_source ?? 'Not reported'}</dd></div>
                <div><dt>Observed</dt><dd>{formatDate(candidate.observations.identity_at)}</dd></div>
              </dl>

              {candidate.verified_matches.length ? <section className={styles.matches}><h4>Existing verified matches</h4>{candidate.verified_matches.map((match) => <div key={match.id}>
                <strong>{match.evidence_type === 'model_alias' ? 'Model alias' : 'Fingerprint'} → {match.profile_name}</strong>
                <code>{match.evidence_value}</code>
                <small>{match.verified ? 'Verified' : 'Unverified'} · {formatDate(match.verified_at)}</small>
                <small><strong>Verified by:</strong> {match.verified_by_name ?? 'Dallmayr administrator'}</small>
                <small><strong>Source:</strong> {match.source_device_code ?? 'Device not visible'} · {humanizeRegion(match.source_telemetry_region)}</small>
                <small><strong>Verification note:</strong> {match.notes ?? 'No note recorded'}</small>
              </div>)}</section> : null}

              <form className={styles.verifyForm} onSubmit={(event) => event.preventDefault()}>
                <label><span>Decoder profile</span><select value={profileKey} onChange={(event) => setProfileKey(event.target.value)}>{candidate.profiles.map((profile) => <option key={profile.id} value={profile.model_key}>{profile.display_name}</option>)}</select></label>
                <label><span>Verification note</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional field-test or machine reference" rows={3} /></label>
                {candidate.can_verify ? <div className={styles.verifyActions}>
                  <button disabled={!candidate.observations.fingerprint || Boolean(savingType)} onClick={() => void verifyEvidence('fingerprint')} type="button">{savingType === 'fingerprint' ? 'Verifying…' : 'Verify fingerprint'}</button>
                  <button disabled={!candidate.observations.model || Boolean(savingType)} onClick={() => void verifyEvidence('model_alias')} type="button">{savingType === 'model_alias' ? 'Verifying…' : 'Verify reported model alias'}</button>
                </div> : <div className={styles.readOnly}><strong>Administrator verification required</strong><span>You can inspect regional identity candidates, but only an administrator can promote globally trusted decoder evidence.</span></div>}
              </form>
            </> : <div className={styles.emptyDetail}>Candidate details are unavailable.</div>}
          </section>
        </div>
      )}
    </section>
  );
}
