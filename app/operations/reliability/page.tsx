'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AssetReliabilityPanel } from '@/components/features/AssetReliabilityPanel';
import { AppShell } from '@/components/layout/AppShell';
import { normaliseLookupTerm } from '@/lib/search/machineSearch';
import { getSupabaseClient } from '@/lib/supabase/client';

type Machine = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  branch: string;
  meter_value: number | null;
  meter_unit: string | null;
  status: string;
  total_count?: number | string | null;
};

function comparable(value: string | null | undefined) {
  return normaliseLookupTerm(value ?? '').toLowerCase();
}

function containsCompleteTerm(machine: Machine, value: string) {
  const term = comparable(value);
  if (!term) return false;

  return [machine.machine_name, machine.serial_number, machine.machine_barcode, machine.branch]
    .some((field) => comparable(field).includes(term));
}

function machineTitle(machine: Machine) {
  return machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine';
}

function formatBranch(branch: string) {
  const value = branch.toLowerCase();
  if (value === 'jhb') return 'Johannesburg';
  if (value === 'cpt') return 'Cape Town';
  if (value === 'kzn') return 'KwaZulu-Natal';
  return branch.toUpperCase();
}

export default function AssetReliabilityPage() {
  const [matches, setMatches] = useState<Machine[]>([]);
  const [selected, setSelected] = useState<Machine | null>(null);
  const [search, setSearch] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const cleanSearch = useMemo(() => normaliseLookupTerm(search), [search]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!cleanSearch) {
      setMatches([]);
      setTotalCount(0);
      setSearching(false);
      setError(null);
      return;
    }

    if (cleanSearch.length < 2) {
      setMatches([]);
      setTotalCount(0);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);

    const handle = window.setTimeout(async () => {
      const { data, error: searchError } = await getSupabaseClient().rpc('search_reliability_machines', {
        p_search: cleanSearch,
        p_limit: 50,
      });

      if (requestId !== requestIdRef.current) return;

      if (searchError) {
        setMatches([]);
        setTotalCount(0);
        setSearching(false);
        setError(`Machine search failed: ${searchError.message}`);
        return;
      }

      const strictMatches = ((data ?? []) as Machine[])
        .filter((machine) => containsCompleteTerm(machine, cleanSearch));

      setMatches(strictMatches);
      setTotalCount(Number(strictMatches[0]?.total_count ?? strictMatches.length));
      setSearching(false);
    }, 220);

    return () => window.clearTimeout(handle);
  }, [cleanSearch]);

  function updateSearch(value: string) {
    setSearch(value);
    setSelected(null);
  }

  return (
    <AppShell>
      <div className="minimal-page-header">
        <span className="minimal-kicker">Operations</span>
        <h1>Asset Reliability</h1>
        <p>Meter readings, preventive triggers and downtime history.</p>
      </div>

      {error ? <div className="error" role="alert">{error}</div> : null}

      <section className="minimal-panel reliability-machine-search-panel">
        <div className="minimal-panel-header">
          <div>
            <h2>Select machine</h2>
            <p>Enter part of the machine name, serial number, QR/barcode or branch. Every displayed result contains the complete sequence you typed.</p>
          </div>
        </div>

        <label className="reliability-search-field">
          Search machines
          <input
            aria-controls="reliability-machine-results"
            aria-describedby="reliability-search-status"
            autoComplete="off"
            autoCorrect="off"
            inputMode="search"
            onChange={(event) => updateSearch(event.target.value)}
            placeholder="Start typing a serial number, barcode or machine name"
            spellCheck={false}
            type="search"
            value={search}
          />
        </label>

        <div aria-atomic="true" aria-live="polite" className="reliability-search-status" id="reliability-search-status">
          {!cleanSearch ? 'Enter at least two characters to start searching.' : null}
          {cleanSearch.length === 1 ? 'Enter one more character to start searching.' : null}
          {cleanSearch.length >= 2 && searching ? `Searching for machines containing “${cleanSearch}”…` : null}
          {cleanSearch.length >= 2 && !searching && !error && totalCount === 0 ? `No machine contains the complete sequence “${cleanSearch}”.` : null}
          {cleanSearch.length >= 2 && !searching && !error && totalCount > 0 ? `${totalCount.toLocaleString('en-ZA')} machine${totalCount === 1 ? '' : 's'} contain the complete sequence “${cleanSearch}”.${totalCount > matches.length ? ` Showing the first ${matches.length}; enter more characters to narrow the results.` : ''}` : null}
        </div>

        {matches.length > 0 ? (
          <div className="reliability-machine-results" id="reliability-machine-results" role="listbox" aria-label="Matching machines">
            {matches.map((machine) => (
              <button
                aria-selected={selected?.id === machine.id}
                className={`reliability-machine-result ${selected?.id === machine.id ? 'is-selected' : ''}`}
                key={machine.id}
                onClick={() => setSelected(machine)}
                role="option"
                type="button"
              >
                <span className="reliability-machine-result-title">{machineTitle(machine)}</span>
                <span className="reliability-machine-result-facts">
                  <span><strong>Serial</strong>{machine.serial_number ?? 'Not recorded'}</span>
                  <span><strong>Barcode</strong>{machine.machine_barcode ?? 'Not recorded'}</span>
                  <span><strong>Branch</strong>{formatBranch(machine.branch)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {selected ? (
        <>
          <div className="reliability-selected-machine" aria-live="polite">
            <div>
              <span className="minimal-kicker">Selected machine</span>
              <strong>{machineTitle(selected)}</strong>
              <small>{selected.serial_number ?? 'No serial number'} · {selected.machine_barcode ?? 'No barcode'} · {formatBranch(selected.branch)}</small>
            </div>
            <button className="button secondary" onClick={() => setSelected(null)} type="button">Clear selection</button>
          </div>
          <AssetReliabilityPanel currentMeter={selected.meter_value} machineId={selected.id} meterUnit={selected.meter_unit} />
        </>
      ) : (
        <div className="minimal-empty">Search for a machine and select a matching result to open its reliability workspace.</div>
      )}
    </AppShell>
  );
}
