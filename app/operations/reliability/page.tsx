'use client';

import { useEffect, useMemo, useState } from 'react';
import { AssetReliabilityPanel } from '@/components/features/AssetReliabilityPanel';
import { AppShell } from '@/components/layout/AppShell';
import { getSupabaseClient } from '@/lib/supabase/client';

type Machine = { id: string; machine_name: string | null; serial_number: string | null; machine_barcode: string | null; branch: string; meter_value: number | null; meter_unit: string | null; status: string };

export default function AssetReliabilityPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabaseClient().from('machines').select('id, machine_name, serial_number, machine_barcode, branch, meter_value, meter_unit, status').not('status', 'eq', 'retired').order('machine_name').limit(2000).then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      else setMachines((data ?? []) as Machine[]);
    });
  }, []);

  const filteredMachines = useMemo(() => {
    const term = search.trim().toLowerCase();
    return machines.filter((machine) => !term || [machine.machine_name, machine.serial_number, machine.machine_barcode, machine.branch].join(' ').toLowerCase().includes(term));
  }, [machines, search]);
  const selected = machines.find((machine) => machine.id === machineId) ?? null;

  return (
    <AppShell>
      <div className="minimal-page-header"><span className="minimal-kicker">Operations</span><h1>Asset Reliability</h1><p>Meter readings, preventive triggers and downtime history.</p></div>
      {error ? <div className="error">{error}</div> : null}
      <section className="minimal-panel">
        <div className="minimal-panel-header"><div><h2>Select machine</h2><p>Search by name, serial number, QR/barcode or branch.</p></div></div>
        <div className="minimal-grid-3">
          <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Machine, serial or barcode" /></label>
          <label>Machine<select value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">Select machine</option>{filteredMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Machine'} — {machine.branch.toUpperCase()}</option>)}</select></label>
        </div>
      </section>
      {selected ? <AssetReliabilityPanel currentMeter={selected.meter_value} machineId={selected.id} meterUnit={selected.meter_unit} /> : <div className="minimal-empty">Select a machine to open its reliability workspace.</div>}
    </AppShell>
  );
}
