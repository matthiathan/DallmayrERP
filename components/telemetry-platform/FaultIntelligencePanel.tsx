'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './FaultIntelligencePanel.module.css';

type FaultStatus = 'raw' | 'verified_rule' | 'telemetry_diagnostic';

type Fault = {
  id: string;
  device_id: string | null;
  machine_id: string | null;
  fault_code: string;
  severity: string;
  source: string;
  detail: string | null;
  canonical_fault_code: string | null;
  canonical_title: string | null;
  fault_category: string | null;
  recommended_action: string | null;
  normalization_status: FaultStatus;
  profile_key: string | null;
  started_at: string;
  last_seen_at: string;
  cleared_at: string | null;
};

type Rule = {
  id: string;
  profile_id: string;
  interface: string | null;
  raw_fault_code: string;
  canonical_fault_code: string;
  title: string;
  category: string | null;
  severity: string | null;
  description: string | null;
  recommended_action: string | null;
  evidence_source: string;
  is_verified: boolean;
  is_active: boolean;
  updated_at: string;
};

type Candidate = {
  id: string;
  fault_event_id: string;
  profile_key: string;
  interface: string | null;
  raw_fault_code: string;
  proposed_canonical_fault_code: string;
  proposed_title: string;
  proposed_category: string | null;
  proposed_severity: string | null;
  proposed_description: string | null;
  proposed_recommended_action: string | null;
  evidence_note: string;
  status: 'pending' | 'verified' | 'rejected';
  created_at: string;
};

type Profile = { id: string; model_key: string; display_name: string | null };

type FormState = {
  canonicalCode: string;
  title: string;
  category: string;
  severity: string;
  description: string;
  action: string;
  evidence: string;
};

const emptyForm: FormState = {
  canonicalCode: '',
  title: '',
  category: '',
  severity: 'fault',
  description: '',
  action: '',
  evidence: '',
};

function dateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(fault: Fault) {
  if (fault.normalization_status === 'telemetry_diagnostic') return 'Telemetry diagnostic';
  if (fault.normalization_status === 'verified_rule') return 'Verified machine interpretation';
  return 'Raw / unverified machine fault';
}

function displayFault(fault: Fault) {
  if (fault.normalization_status !== 'raw' && fault.canonical_title) return fault.canonical_title;
  return `Unknown machine fault ${fault.fault_code}`;
}

export function FaultIntelligencePanel({ machineId, management = false }: { machineId?: string; management?: boolean }) {
  const [faults, setFaults] = useState<Fault[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [role, setRole] = useState('');
  const [selectedFault, setSelectedFault] = useState<Fault | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = management && ['admin', 'operations', 'technician', 'road_technician'].includes(role);
  const canReview = management && ['admin', 'operations'].includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      let faultQuery = client
        .from('telemetry_fault_events')
        .select('id,device_id,machine_id,fault_code,severity,source,detail,canonical_fault_code,canonical_title,fault_category,recommended_action,normalization_status,profile_key,started_at,last_seen_at,cleared_at')
        .order('last_seen_at', { ascending: false })
        .limit(management ? 250 : 100);
      if (machineId) faultQuery = faultQuery.eq('machine_id', machineId);

      const ruleQuery = management
        ? client.from('machine_model_fault_rules').select('id,profile_id,interface,raw_fault_code,canonical_fault_code,title,category,severity,description,recommended_action,evidence_source,is_verified,is_active,updated_at').order('updated_at', { ascending: false }).limit(500)
        : Promise.resolve({ data: [] as Rule[], error: null });
      const candidateQuery = management
        ? client.from('telemetry_fault_rule_candidates').select('id,fault_event_id,profile_key,interface,raw_fault_code,proposed_canonical_fault_code,proposed_title,proposed_category,proposed_severity,proposed_description,proposed_recommended_action,evidence_note,status,created_at').order('created_at', { ascending: false }).limit(250)
        : Promise.resolve({ data: [] as Candidate[], error: null });
      const profileQuery = management
        ? client.from('machine_model_profiles').select('id,model_key,display_name').order('display_name').limit(1000)
        : Promise.resolve({ data: [] as Profile[], error: null });
      const roleQuery = management
        ? client.rpc('current_app_role')
        : Promise.resolve({ data: '', error: null });

      const [faultResult, ruleResult, candidateResult, profileResult, roleResult] = await Promise.all([
        faultQuery,
        ruleQuery,
        candidateQuery,
        profileQuery,
        roleQuery,
      ]);

      if (faultResult.error) throw faultResult.error;
      if (ruleResult.error) throw ruleResult.error;
      if (candidateResult.error) throw candidateResult.error;
      if (profileResult.error) throw profileResult.error;

      setFaults((faultResult.data ?? []) as Fault[]);
      setRules((ruleResult.data ?? []) as Rule[]);
      setCandidates((candidateResult.data ?? []) as Candidate[]);
      setProfiles(Object.fromEntries(((profileResult.data ?? []) as Profile[]).map((profile) => [profile.id, profile])));
      setRole(roleResult.error ? '' : String(roleResult.data ?? ''));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load fault intelligence.');
    } finally {
      setLoading(false);
    }
  }, [machineId, management]);

  useEffect(() => { void load(); }, [load]);

  const activeFaults = useMemo(() => faults.filter((fault) => !fault.cleared_at), [faults]);
  const unknownFaults = useMemo(() => faults.filter((fault) => fault.normalization_status === 'raw'), [faults]);
  const interpretedFaults = useMemo(() => faults.filter((fault) => fault.normalization_status !== 'raw'), [faults]);
  const platformDiagnostics = useMemo(() => faults.filter((fault) => fault.normalization_status === 'telemetry_diagnostic'), [faults]);
  const pendingCandidates = useMemo(() => candidates.filter((candidate) => candidate.status === 'pending'), [candidates]);
  const verifiedRules = useMemo(() => rules.filter((rule) => rule.is_verified && rule.is_active), [rules]);

  const startProposal = (fault: Fault) => {
    if (fault.normalization_status !== 'raw') return;
    setSelectedFault(fault);
    setForm({
      canonicalCode: '',
      title: '',
      category: '',
      severity: fault.severity || 'fault',
      description: fault.detail ?? '',
      action: '',
      evidence: `Observed on ${dateTime(fault.last_seen_at)} via ${fault.source || 'machine telemetry'}.`,
    });
    setNotice(null);
  };

  const submitProposal = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFault || selectedFault.normalization_status !== 'raw') return;
    setBusy(selectedFault.id);
    setError(null);
    setNotice(null);
    try {
      const { data, error: submitError } = await getSupabaseClient().rpc('submit_telemetry_fault_rule_candidate_v1', {
        p_fault_event_id: selectedFault.id,
        p_canonical_fault_code: form.canonicalCode.trim(),
        p_title: form.title.trim(),
        p_category: form.category.trim() || null,
        p_severity: form.severity || null,
        p_description: form.description.trim() || null,
        p_recommended_action: form.action.trim() || null,
        p_evidence_note: form.evidence.trim(),
      });
      if (submitError) throw submitError;
      const result = data as { duplicate?: boolean } | null;
      setNotice(result?.duplicate ? 'A pending proposal already exists for this profile, interface and raw code.' : 'Fault mapping submitted for operations/admin verification.');
      setSelectedFault(null);
      setForm(emptyForm);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit fault mapping.');
    } finally {
      setBusy(null);
    }
  };

  const reviewCandidate = async (candidate: Candidate, action: 'verify' | 'reject') => {
    setBusy(candidate.id);
    setError(null);
    setNotice(null);
    try {
      const { error: reviewError } = await getSupabaseClient().rpc('review_telemetry_fault_rule_candidate_v1', {
        p_candidate_id: candidate.id,
        p_action: action,
        p_review_note: action === 'verify'
          ? 'Verified in DallmayrERP fault catalogue workbench.'
          : 'Rejected in DallmayrERP fault catalogue workbench.',
      });
      if (reviewError) throw reviewError;
      setNotice(action === 'verify' ? 'Fault mapping verified and activated for the machine profile.' : 'Fault mapping proposal rejected.');
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Could not review fault mapping.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.panel} data-fault-intelligence-panel={management ? 'workbench' : 'machine'}>
      <header className={styles.header}>
        <div>
          <span>Machine fault intelligence</span>
          <h2>{management ? 'Fault catalogue & verification' : 'Fault interpretation'}</h2>
          <p>{management
            ? 'Capture field evidence for unknown machine codes. Telemetry diagnostics are kept separate, and pending proposals never affect live severity until operations/admin verification.'
            : 'Verified machine-profile meanings and telemetry diagnostics are shown alongside the original raw code.'}</p>
        </div>
        <button disabled={loading} onClick={() => void load()} type="button">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {loading ? <HamsterLoader label="Loading fault intelligence" /> : null}

      {!loading ? <>
        <div className={styles.metrics}>
          <div><span>Active faults</span><strong>{activeFaults.length}</strong></div>
          <div><span>Interpreted faults</span><strong>{interpretedFaults.length}</strong></div>
          <div><span>Unknown machine faults</span><strong>{unknownFaults.length}</strong></div>
          {management ? <div><span>Pending verification</span><strong>{pendingCandidates.length}</strong></div> : <div><span>Telemetry diagnostics</span><strong>{platformDiagnostics.length}</strong></div>}
        </div>

        <div className={styles.faultList}>
          {faults.slice(0, management ? 30 : 20).map((fault) => (
            <article className={`${styles.fault} ${fault.normalization_status === 'raw' ? styles.raw : styles.verified}`} key={fault.id}>
              <div className={styles.faultTop}>
                <div>
                  <span>{statusLabel(fault)}</span>
                  <h3>{displayFault(fault)}</h3>
                </div>
                <b>{fault.cleared_at ? 'Resolved' : fault.severity}</b>
              </div>
              <dl>
                <div><dt>Raw code</dt><dd>{fault.fault_code}</dd></div>
                <div><dt>Canonical code</dt><dd>{fault.canonical_fault_code ?? 'Not verified'}</dd></div>
                <div><dt>Category</dt><dd>{fault.fault_category ?? 'Unknown'}</dd></div>
                <div><dt>Source</dt><dd>{fault.source || 'Not reported'}</dd></div>
              </dl>
              <p>{fault.detail ?? 'No machine detail supplied.'}</p>
              <div className={styles.actionText}><strong>Recommended action:</strong> {fault.recommended_action ?? 'No verified technician action yet.'}</div>
              <footer>
                <span>Last seen {dateTime(fault.last_seen_at)}</span>
                {management && canSubmit && fault.normalization_status === 'raw' ? <button onClick={() => startProposal(fault)} type="button">Propose mapping</button> : null}
              </footer>
            </article>
          ))}
          {!faults.length ? <div className={styles.empty}>No fault events have been recorded.</div> : null}
        </div>

        {management && selectedFault && canSubmit ? <form className={styles.form} onSubmit={submitProposal}>
          <header>
            <div><span>Evidence capture</span><h3>Propose mapping for raw code {selectedFault.fault_code}</h3></div>
            <button onClick={() => setSelectedFault(null)} type="button">Cancel</button>
          </header>
          <div className={styles.formGrid}>
            <label>Canonical code<input required value={form.canonicalCode} onChange={(event) => setForm((current) => ({ ...current, canonicalCode: event.target.value }))} placeholder="e.g. WATER.SUPPLY" /></label>
            <label>Fault title<input required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Verified fault name" /></label>
            <label>Category<input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Water, payment, brewer…" /></label>
            <label>Severity<select value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value }))}><option value="info">Info</option><option value="warning">Warning</option><option value="fault">Fault</option><option value="critical">Critical</option></select></label>
            <label className={styles.wide}>Description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            <label className={styles.wide}>Recommended technician action<textarea value={form.action} onChange={(event) => setForm((current) => ({ ...current, action: event.target.value }))} /></label>
            <label className={styles.wide}>Evidence / source<textarea required value={form.evidence} onChange={(event) => setForm((current) => ({ ...current, evidence: event.target.value }))} placeholder="Service manual page, Test Center capture, confirmed field test…" /></label>
          </div>
          <button className={styles.primary} disabled={busy === selectedFault.id} type="submit">{busy === selectedFault.id ? 'Submitting…' : 'Submit for verification'}</button>
        </form> : null}

        {management ? <div className={styles.workbenchGrid}>
          <section className={styles.card}>
            <header><div><span>Review queue</span><h3>Pending machine-fault mappings</h3></div><strong>{pendingCandidates.length}</strong></header>
            <div className={styles.compactList}>
              {pendingCandidates.map((candidate) => <article key={candidate.id}>
                <div><b>{candidate.proposed_title}</b><span>{candidate.profile_key} · raw {candidate.raw_fault_code} · {candidate.interface ?? 'any'}</span></div>
                <p>{candidate.proposed_canonical_fault_code} · {candidate.proposed_severity ?? 'severity unchanged'} · {candidate.evidence_note}</p>
                {canReview ? <footer><button disabled={busy === candidate.id} onClick={() => void reviewCandidate(candidate, 'reject')} type="button">Reject</button><button className={styles.primary} disabled={busy === candidate.id} onClick={() => void reviewCandidate(candidate, 'verify')} type="button">Verify & activate</button></footer> : <small>Operations/admin verification required.</small>}
              </article>)}
              {!pendingCandidates.length ? <div className={styles.empty}>No machine-fault mappings are awaiting verification.</div> : null}
            </div>
          </section>

          <section className={styles.card}>
            <header><div><span>Verified catalogue</span><h3>Active machine-profile rules</h3></div><strong>{verifiedRules.length}</strong></header>
            <div className={styles.compactList}>
              {verifiedRules.slice(0, 100).map((rule) => <article key={rule.id}>
                <div><b>{rule.title}</b><span>{profiles[rule.profile_id]?.display_name ?? profiles[rule.profile_id]?.model_key ?? 'Machine profile'} · raw {rule.raw_fault_code} · {rule.interface ?? 'any'}</span></div>
                <p>{rule.canonical_fault_code} · {rule.severity ?? 'severity unchanged'}{rule.recommended_action ? ` · ${rule.recommended_action}` : ''}</p>
                <small>{rule.evidence_source}</small>
              </article>)}
              {!verifiedRules.length ? <div className={styles.empty}>No manufacturer fault meanings have been verified yet.</div> : null}
            </div>
          </section>
        </div> : null}
      </> : null}
    </section>
  );
}
