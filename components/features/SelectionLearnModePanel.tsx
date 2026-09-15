'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

type Observation = {
  id: number;
  event_id: string;
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  machine_model: string | null;
  interface: 'mdb' | 'dex';
  selection_code: string | null;
  item_number: number | null;
  price_minor: number | null;
  currency: string;
  result: 'observed' | 'requested' | 'approved' | 'denied' | 'success' | 'failure';
  source: string;
  confirmation: string | null;
  confidence: 'observed' | 'probable' | 'confirmed' | 'failed';
  observed_at: string;
  received_at: string;
};

type Product = { id: string; product_name: string; is_active: boolean };
type Profile = { model_key: string; button_count: number };

type Draft = {
  modelKey: string;
  slotNumber: number;
  productId: string;
};

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function money(value: number | null, currency: string) {
  if (value === null) return '—';
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(value / 100);
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}

export function SelectionLearnModePanel() {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const client = getSupabaseClient();
    setError(null);
    try {
      const [observationResult, productResult, profileResult] = await Promise.all([
        client.rpc('get_recent_telemetry_selection_observations', { p_limit: 50 }),
        client.from('products').select('id,product_name,is_active').eq('is_active', true).order('product_name'),
        client.from('machine_model_profiles').select('model_key,button_count').order('model_key'),
      ]);
      if (observationResult.error) throw observationResult.error;
      if (productResult.error) throw productResult.error;
      if (profileResult.error) throw profileResult.error;

      const nextObservations = (observationResult.data ?? []) as Observation[];
      const nextProfiles = (profileResult.data ?? []) as Profile[];
      setObservations(nextObservations);
      setProducts((productResult.data ?? []) as Product[]);
      setProfiles(nextProfiles);
      setDrafts((current) => {
        const next = { ...current };
        for (const row of nextObservations) {
          if (next[row.id]) continue;
          const modelKey = row.machine_model?.trim() || '';
          const profile = nextProfiles.find((item) => item.model_key.toLowerCase() === modelKey.toLowerCase());
          next[row.id] = { modelKey, slotNumber: Math.max(1, profile?.button_count ? 1 : 1), productId: '' };
        }
        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load live selection observations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const timer = window.setInterval(() => load().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const unique = useMemo(() => {
    const seen = new Set<string>();
    return observations.filter((row) => {
      const key = `${row.device_id}:${row.selection_code ?? row.item_number ?? 'unknown'}:${row.result}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);
  }, [observations]);

  function patchDraft(id: number, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function mapObservation(row: Observation) {
    const selectionCode = row.selection_code?.trim();
    const draft = drafts[row.id];
    if (!selectionCode || !draft?.modelKey.trim() || !draft.productId) return;
    setSavingId(row.id);
    setError(null);
    setNotice(null);
    try {
      const { error: mapError } = await getSupabaseClient().rpc('assign_learned_selection_mapping', {
        p_model_key: draft.modelKey.trim(),
        p_slot_number: Math.max(1, Math.min(100, Math.trunc(draft.slotNumber || 1))),
        p_selection_code: selectionCode,
        p_product_id: draft.productId,
      });
      if (mapError) throw mapError;
      const product = products.find((item) => item.id === draft.productId);
      setNotice(`${selectionCode} is now mapped to ${product?.product_name ?? 'the selected product'} for ${draft.modelKey}.`);
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : 'Could not save the learned selection mapping.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="fleet-panel fleet-table-panel" data-selection-learn-mode="live">
      <header className="fleet-table-heading">
        <div><span>Learn mode</span><h2>Live machine selections</h2></div>
        <button className="fleet-button secondary" onClick={() => load()} type="button">Refresh</button>
      </header>
      <p>Passive MDB observations appear here before they become sales. For a button machine, Slot is the physical button number. For a touchscreen, Slot is only a logical mapping slot; the raw MDB selection code is the durable product identifier.</p>

      <div className="fleet-banner" role="note">
        <strong>Passive capture only</strong>
        <span>Learn Mode does not transmit onto MDB and does not increment cup counters. A sale is still counted only by the completed-vend path.</span>
      </div>

      {error ? <div className="fleet-banner is-error" role="alert"><strong>Learn Mode needs attention.</strong><span>{error}</span></div> : null}
      {notice ? <div className="fleet-banner" role="status"><strong>Mapping saved.</strong><span>{notice}</span></div> : null}

      {loading ? (
        <div className="fleet-empty-state"><strong>Loading live selections…</strong></div>
      ) : unique.length === 0 ? (
        <div className="fleet-empty-state"><strong>No Learn Mode selections received yet</strong><p>Once V6.8.49 is flashed and a machine emits a usable MDB item number, the observation will appear here.</p></div>
      ) : (
        <div className="fleet-table-scroll">
          <table className="fleet-machine-table">
            <thead><tr><th>Machine / device</th><th>Raw selection</th><th>Lifecycle</th><th>Price</th><th>Observed</th><th>Map product</th></tr></thead>
            <tbody>
              {unique.map((row) => {
                const draft = drafts[row.id] ?? { modelKey: row.machine_model ?? '', slotNumber: 1, productId: '' };
                return (
                  <tr key={row.id}>
                    <td><strong>{row.machine_name || row.machine_model || 'Unassigned machine'}</strong><span>{row.device_code} · {row.interface.toUpperCase()}</span></td>
                    <td><strong>{row.selection_code || 'Undefined item'}</strong><span>{row.item_number === null ? 'No defined MDB item number' : `Item ${row.item_number}`}</span></td>
                    <td><span className={`fleet-status-pill is-${row.result === 'success' ? 'success' : row.result === 'failure' || row.result === 'denied' ? 'warning' : 'neutral'}`}><i />{row.result}</span><span>{row.confirmation || row.source} · {row.confidence}</span></td>
                    <td>{money(row.price_minor, row.currency)}</td>
                    <td>{when(row.observed_at)}</td>
                    <td>
                      {row.selection_code ? (
                        <div>
                          <input aria-label={`Machine model for ${row.selection_code}`} list="learn-mode-profiles" onChange={(event) => patchDraft(row.id, { modelKey: event.target.value })} placeholder="Machine model" value={draft.modelKey} />
                          <input aria-label={`Mapping slot for ${row.selection_code}`} max={100} min={1} onChange={(event) => patchDraft(row.id, { slotNumber: Number(event.target.value) })} type="number" value={draft.slotNumber} />
                          <select aria-label={`Product for ${row.selection_code}`} onChange={(event) => patchDraft(row.id, { productId: event.target.value })} value={draft.productId}>
                            <option value="">Choose product</option>
                            {products.map((product) => <option key={product.id} value={product.id}>{product.product_name}</option>)}
                          </select>
                          <button className="fleet-button" disabled={savingId === row.id || !draft.modelKey.trim() || !draft.productId} onClick={() => mapObservation(row)} type="button">{savingId === row.id ? 'Saving…' : 'Map selection'}</button>
                        </div>
                      ) : <span>Undefined MDB item IDs are retained for diagnostics but cannot be mapped automatically.</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="learn-mode-profiles">{profiles.map((profile) => <option key={profile.model_key} value={profile.model_key} />)}</datalist>
        </div>
      )}
    </section>
  );
}
