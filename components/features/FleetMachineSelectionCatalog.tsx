'use client';

import { useEffect, useMemo, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import {
  getMachineSelectionProfile,
  type MachineSelectionMode,
} from '@/lib/telemetry/machine-button-presets';
import { getSupabaseClient } from '@/lib/supabase/client';

type FleetModelCount = {
  model: string;
  count: number;
};

type CatalogFilter = 'mappable' | MachineSelectionMode | 'all';

const PAGE_SIZE = 1000;

function modelKey(model: string | null, machineName: string | null) {
  return model?.trim() || machineName?.trim() || '(unknown model)';
}

function normalise(value: string) {
  return value.trim().toLocaleUpperCase('en-ZA').replace(/\s+/g, ' ');
}

function modeLabel(mode: MachineSelectionMode) {
  switch (mode) {
    case 'direct-buttons': return 'Direct buttons';
    case 'touchscreen': return 'Touch / logical';
    case 'accessory': return 'Accessory';
    default: return 'Manual / verify';
  }
}

function modePill(mode: MachineSelectionMode) {
  switch (mode) {
    case 'direct-buttons': return 'success';
    case 'touchscreen': return 'info';
    case 'accessory': return 'neutral';
    default: return 'warning';
  }
}

async function loadFleetModelCounts() {
  const client = getSupabaseClient();
  const counts = new Map<string, FleetModelCount>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('machines')
      .select('model,machine_name')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const rows = (data ?? []) as Array<{ model: string | null; machine_name: string | null }>;

    rows.forEach((row) => {
      const model = modelKey(row.model, row.machine_name);
      const key = normalise(model);
      const current = counts.get(key);
      counts.set(key, { model: current?.model ?? model, count: (current?.count ?? 0) + 1 });
    });

    if (rows.length < PAGE_SIZE) break;
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
}

export function FleetMachineSelectionCatalog() {
  const [models, setModels] = useState<FleetModelCount[]>([]);
  const [filter, setFilter] = useState<CatalogFilter>('mappable');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await loadFleetModelCounts();
        if (!cancelled) setModels(next);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load the fleet machine catalog.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load().catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => models.map((entry) => ({
    ...entry,
    profile: getMachineSelectionProfile(entry.model),
  })), [models]);

  const filtered = useMemo(() => {
    const term = normalise(search);
    return rows.filter((row) => {
      if (term && !normalise(row.model).includes(term)) return false;
      if (filter === 'all') return true;
      if (filter === 'mappable') return row.profile.mode !== 'accessory';
      return row.profile.mode === filter;
    });
  }, [filter, rows, search]);

  const fleetAssets = rows.reduce((total, row) => total + row.count, 0);
  const directAssets = rows.filter((row) => row.profile.mode === 'direct-buttons').reduce((total, row) => total + row.count, 0);
  const touchscreenAssets = rows.filter((row) => row.profile.mode === 'touchscreen').reduce((total, row) => total + row.count, 0);
  const accessoryAssets = rows.filter((row) => row.profile.mode === 'accessory').reduce((total, row) => total + row.count, 0);

  return (
    <section className="fleet-panel fleet-table-panel" data-machine-selection-catalog="fleet-v1">
      <header className="fleet-table-heading">
        <div>
          <span>Machine selection library</span>
          <h2>Fleet button and menu types</h2>
        </div>
        <span>{models.length} model names · {fleetAssets.toLocaleString('en-ZA')} assets</span>
      </header>

      <p>
        Direct-button machines use verified physical selection counts where known. Touchscreen machines are mapped from the raw logical selection codes observed in telemetry. Accessories are excluded from drink mapping, and unverified models remain manual until confirmed.
      </p>

      <div className="grid grid-4">
        <div><strong>{directAssets.toLocaleString('en-ZA')}</strong><span>assets with verified direct-button layouts</span></div>
        <div><strong>{touchscreenAssets.toLocaleString('en-ZA')}</strong><span>touch/logical-menu assets</span></div>
        <div><strong>{accessoryAssets.toLocaleString('en-ZA')}</strong><span>accessories needing no drink map</span></div>
        <div><strong>{rows.filter((row) => !row.profile.verified).length}</strong><span>model names still requiring field verification</span></div>
      </div>

      <div className="fleet-filters">
        <label className="fleet-search">
          <span>Find model</span>
          <input
            aria-label="Search machine selection library"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="XS Grande, Belluno, F12…"
            value={search}
          />
        </label>
        <label>
          <span>Selection type</span>
          <select aria-label="Filter machine selection type" onChange={(event) => setFilter(event.target.value as CatalogFilter)} value={filter}>
            <option value="mappable">Mappable beverage machines</option>
            <option value="direct-buttons">Direct buttons</option>
            <option value="touchscreen">Touch / logical</option>
            <option value="manual">Manual / verify</option>
            <option value="accessory">Accessories</option>
            <option value="all">All fleet assets</option>
          </select>
        </label>
      </div>

      {error ? (
        <div className="fleet-banner is-error" role="alert">
          <strong>Machine selection library could not load.</strong>
          <span>{error}</span>
        </div>
      ) : loading ? (
        <HamsterLoader label="Loading fleet machine selection library" />
      ) : filtered.length === 0 ? (
        <div className="fleet-empty-state"><strong>No matching machine models</strong><p>Change the search or selection-type filter.</p></div>
      ) : (
        <div className="fleet-table-scroll">
          <table className="fleet-machine-table">
            <thead>
              <tr>
                <th>Machine model</th>
                <th>Fleet</th>
                <th>Selection interface</th>
                <th>Selections</th>
                <th>Mapping method</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={normalise(row.model)}>
                  <td><strong>{row.model}</strong></td>
                  <td>{row.count.toLocaleString('en-ZA')}</td>
                  <td>
                    <span className={`fleet-status-pill is-${modePill(row.profile.mode)}`}>
                      <i />
                      {modeLabel(row.profile.mode)}
                    </span>
                  </td>
                  <td>
                    {row.profile.buttonCount !== null
                      ? <><strong>{row.profile.buttonCount}</strong><span> verified direct selections</span></>
                      : row.profile.mode === 'touchscreen'
                        ? 'Learn from telemetry'
                        : row.profile.mode === 'accessory'
                          ? 'Not applicable'
                          : 'Verify / learn'}
                  </td>
                  <td>
                    <strong>{row.profile.verified ? 'Classified' : 'Field verification required'}</strong>
                    <span>{row.profile.note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
