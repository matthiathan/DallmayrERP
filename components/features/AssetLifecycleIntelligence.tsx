'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type MachineRow = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  model: string | null;
  branch: string;
  status: string;
  condition: string;
  criticality: string;
  parent_machine_id: string | null;
  manufacturer: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  replacement_cost: number | null;
  expected_life_months: number | null;
  replacement_due_at: string | null;
  meter_value: number;
  meter_unit: string;
  last_meter_at: string | null;
  downtime_minutes_total: number;
  last_service_at: string | null;
  next_service_at: string | null;
};
type MeterRow = { id: string; reading: number; unit: string; source: string; notes: string | null; recorded_at: string };
type DowntimeRow = { id: string; started_at: string; ended_at: string; downtime_minutes: number; reason: string | null; notes: string | null; work_item_id: string | null; service_job_id: string | null };
type PlanRow = { id: string; plan_number: string; title: string; trigger_type: string; next_due_at: string | null; next_due_meter: number | null; is_active: boolean; last_generated_work_item_id: string | null };
type WorkCostRow = { id: string; work_number: string; title: string; status: string; completed_at: string | null };
type TimeCostRow = { work_item_id: string; minutes: number; hourly_rate: number | null };
type PartCostRow = { work_item_id: string; quantity: number; unit_cost: number | null };

function assetLabel(machine: Pick<MachineRow, 'machine_name' | 'serial_number' | 'machine_barcode'>) {
  return machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed asset';
}

export function AssetLifecycleIntelligence() {
  const { userDetails } = useAuth();
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [meters, setMeters] = useState<MeterRow[]>([]);
  const [downtime, setDowntime] = useState<DowntimeRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [work, setWork] = useState<WorkCostRow[]>([]);
  const [timeCosts, setTimeCosts] = useState<TimeCostRow[]>([]);
  const [partCosts, setPartCosts] = useState<PartCostRow[]>([]);
  const [parentId, setParentId] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [replacementCost, setReplacementCost] = useState('');
  const [expectedLifeMonths, setExpectedLifeMonths] = useState('');
  const [replacementDueAt, setReplacementDueAt] = useState('');
  const [meterUnit, setMeterUnit] = useState('hours');
  const [meterReading, setMeterReading] = useState('');
  const [meterSource, setMeterSource] = useState('manual');
  const [meterNotes, setMeterNotes] = useState('');
  const [downtimeStart, setDowntimeStart] = useState('');
  const [downtimeEnd, setDowntimeEnd] = useState('');
  const [downtimeReason, setDowntimeReason] = useState('');
  const [downtimeNotes, setDowntimeNotes] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManage = ['admin', 'operations'].includes(userDetails?.role ?? '');
  const selected = machines.find((machine) => machine.id === selectedId) ?? null;

  async function loadMachines() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().from('machines').select('id, machine_name, serial_number, machine_barcode, model, branch, status, condition, criticality, parent_machine_id, manufacturer, purchase_date, purchase_cost, replacement_cost, expected_life_months, replacement_due_at, meter_value, meter_unit, last_meter_at, downtime_minutes_total, last_service_at, next_service_at').order('machine_name').limit(2000);
    if (loadError) {
      setError(loadError.message);
    } else {
      const rows = (data ?? []) as MachineRow[];
      setMachines(rows);
      setSelectedId((current) => current || rows[0]?.id || '');
    }
    setLoading(false);
  }

  async function loadAsset(machineId: string) {
    if (!machineId) return;
    const client = getSupabaseClient();
    const [meterResult, downtimeResult, planResult, workResult] = await Promise.all([
      client.from('asset_meter_readings').select('id, reading, unit, source, notes, recorded_at').eq('machine_id', machineId).order('recorded_at', { ascending: false }).limit(100),
      client.from('asset_downtime_events').select('id, started_at, ended_at, downtime_minutes, reason, notes, work_item_id, service_job_id').eq('machine_id', machineId).order('started_at', { ascending: false }).limit(100),
      client.from('maintenance_plans').select('id, plan_number, title, trigger_type, next_due_at, next_due_meter, is_active, last_generated_work_item_id').eq('machine_id', machineId).order('next_due_at', { ascending: true, nullsFirst: false }),
      client.from('work_items').select('id, work_number, title, status, completed_at').eq('machine_id', machineId).order('created_at', { ascending: false }).limit(200),
    ]);
    const firstError = meterResult.error ?? downtimeResult.error ?? planResult.error ?? workResult.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }
    const workRows = (workResult.data ?? []) as WorkCostRow[];
    setMeters((meterResult.data ?? []) as MeterRow[]);
    setDowntime((downtimeResult.data ?? []) as DowntimeRow[]);
    setPlans((planResult.data ?? []) as PlanRow[]);
    setWork(workRows);

    const workIds = workRows.map((item) => item.id);
    if (workIds.length) {
      const [timeResult, partResult] = await Promise.all([
        client.from('work_time_entries').select('work_item_id, minutes, hourly_rate').in('work_item_id', workIds),
        client.from('work_parts_used').select('work_item_id, quantity, unit_cost').in('work_item_id', workIds),
      ]);
      setTimeCosts(timeResult.error ? [] : (timeResult.data ?? []) as TimeCostRow[]);
      setPartCosts(partResult.error ? [] : (partResult.data ?? []) as PartCostRow[]);
    } else {
      setTimeCosts([]);
      setPartCosts([]);
    }
  }

  useEffect(() => {
    loadMachines().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load assets.');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setParentId(selected.parent_machine_id ?? '');
    setManufacturer(selected.manufacturer ?? '');
    setPurchaseDate(selected.purchase_date ?? '');
    setPurchaseCost(selected.purchase_cost !== null ? String(selected.purchase_cost) : '');
    setReplacementCost(selected.replacement_cost !== null ? String(selected.replacement_cost) : '');
    setExpectedLifeMonths(selected.expected_life_months !== null ? String(selected.expected_life_months) : '');
    setReplacementDueAt(selected.replacement_due_at ?? '');
    setMeterUnit(selected.meter_unit);
    setMeterReading(String(selected.meter_value));
    loadAsset(selected.id).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load asset history.'));
  }, [selectedId, selected?.updated_at]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    const { error: saveError } = await getSupabaseClient().rpc('update_asset_professional_profile', {
      p_machine_id: selected.id,
      p_parent_machine_id: parentId || null,
      p_manufacturer: manufacturer.trim() || null,
      p_purchase_date: purchaseDate || null,
      p_purchase_cost: purchaseCost ? Number(purchaseCost) : null,
      p_replacement_cost: replacementCost ? Number(replacementCost) : null,
      p_expected_life_months: expectedLifeMonths ? Number(expectedLifeMonths) : null,
      p_replacement_due_at: replacementDueAt || null,
      p_meter_unit: meterUnit,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setMessage('Asset lifecycle profile updated.');
    await loadMachines();
  }

  async function recordMeter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !meterReading) return;
    setSaving(true);
    setError(null);
    const { data, error: meterError } = await getSupabaseClient().rpc('record_asset_meter_reading', {
      p_machine_id: selected.id,
      p_reading: Number(meterReading),
      p_unit: meterUnit,
      p_source: meterSource,
      p_notes: meterNotes.trim() || null,
    });
    setSaving(false);
    if (meterError) {
      setError(meterError.message);
      return;
    }
    setMessage(Number(data) > 0 ? `Meter recorded and ${data} maintenance work item(s) generated.` : 'Meter reading recorded.');
    setMeterNotes('');
    await loadMachines();
    await loadAsset(selected.id);
  }

  async function recordDowntime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !downtimeStart || !downtimeEnd) return;
    setSaving(true);
    setError(null);
    const { error: downtimeError } = await getSupabaseClient().rpc('record_asset_downtime', {
      p_machine_id: selected.id,
      p_started_at: new Date(downtimeStart).toISOString(),
      p_ended_at: new Date(downtimeEnd).toISOString(),
      p_reason: downtimeReason.trim() || null,
      p_notes: downtimeNotes.trim() || null,
      p_work_item_id: null,
      p_service_job_id: null,
    });
    setSaving(false);
    if (downtimeError) {
      setError(downtimeError.message);
      return;
    }
    setMessage('Downtime recorded.');
    setDowntimeStart('');
    setDowntimeEnd('');
    setDowntimeReason('');
    setDowntimeNotes('');
    await loadMachines();
    await loadAsset(selected.id);
  }

  const filteredMachines = useMemo(() => {
    const term = search.trim().toLowerCase();
    return machines.filter((machine) => !term || [assetLabel(machine), machine.serial_number, machine.machine_barcode, machine.model, machine.manufacturer, machine.branch].join(' ').toLowerCase().includes(term));
  }, [machines, search]);
  const children = machines.filter((machine) => machine.parent_machine_id === selectedId);
  const directCost = timeCosts.reduce((sum, entry) => sum + entry.minutes / 60 * Number(entry.hourly_rate ?? 0), 0) + partCosts.reduce((sum, part) => sum + part.quantity * Number(part.unit_cost ?? 0), 0);
  const openWork = work.filter((item) => !['completed', 'cancelled'].includes(item.status)).length;
  const duePlans = plans.filter((plan) => plan.is_active && ((plan.next_due_at && new Date(plan.next_due_at).getTime() <= Date.now()) || (plan.next_due_meter !== null && selected && Number(selected.meter_value) >= Number(plan.next_due_meter)))).length;
  const replacementRisk = Boolean(selected?.replacement_due_at && new Date(selected.replacement_due_at).getTime() <= Date.now() + 180 * 86400000);

  return (
    <div className="grid">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="minimal-split">
        <aside className="neo-card">
          <div className="minimal-toolbar"><div><h2>Assets</h2><p>Select an asset to inspect.</p></div><button className="button secondary" onClick={loadMachines} type="button">Refresh</button></div>
          <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, serial, barcode or manufacturer" /></label>
          <div className="minimal-list minimal-form-section">{filteredMachines.length === 0 ? <div className="minimal-empty">{loading ? 'Loading assets...' : 'No matching assets.'}</div> : filteredMachines.slice(0, 150).map((machine) => <button className={`minimal-list-item ${selectedId === machine.id ? 'is-selected' : ''}`} key={machine.id} onClick={() => setSelectedId(machine.id)} type="button"><div><h3>{assetLabel(machine)}</h3><p>{machine.serial_number ?? machine.model ?? 'No serial'} • {machine.branch.toUpperCase()}</p></div><StatusBadge value={machine.condition} /></button>)}</div>
        </aside>

        <section className="grid">
          {!selected ? <div className="minimal-empty">Select an asset.</div> : <>
            <section className="neo-card"><div className="minimal-toolbar"><div><h2>{assetLabel(selected)}</h2><p>{selected.manufacturer ?? 'Manufacturer not recorded'} • {selected.model ?? 'No model'} • {selected.branch.toUpperCase()}</p></div><div className="action-row"><StatusBadge value={selected.status} /><StatusBadge value={selected.condition} /><StatusBadge value={selected.criticality} /><Link className="button secondary" href={`/operations/assets/${selected.id}`}>Full record</Link></div></div></section>

            <div className="minimal-metric-grid">
              <div className="minimal-metric"><span>Meter</span><strong>{selected.meter_value} {selected.meter_unit}</strong></div>
              <div className="minimal-metric"><span>Downtime</span><strong>{Math.round(selected.downtime_minutes_total / 60)} h</strong></div>
              <div className="minimal-metric"><span>Open work</span><strong>{openWork}</strong></div>
              <div className="minimal-metric"><span>Maintenance due</span><strong>{duePlans}</strong></div>
              <div className="minimal-metric"><span>Direct service cost</span><strong>R {directCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
              <div className="minimal-metric"><span>Child assets</span><strong>{children.length}</strong></div>
            </div>

            {replacementRisk ? <div className="error">Replacement date is within six months: {selected.replacement_due_at}</div> : null}

            {canManage ? <section className="neo-card"><div className="minimal-toolbar"><div><h2>Lifecycle and hierarchy</h2><p>Commercial, parent-child and replacement data.</p></div></div><form className="grid" onSubmit={saveProfile}><div className="form-grid"><label>Parent asset<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">No parent</option>{machines.filter((machine) => machine.id !== selected.id).map((machine) => <option key={machine.id} value={machine.id}>{assetLabel(machine)}</option>)}</select></label><label>Manufacturer<input value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} /></label><label>Purchase date<input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></label><label>Purchase cost<input min="0" step="0.01" type="number" value={purchaseCost} onChange={(event) => setPurchaseCost(event.target.value)} /></label><label>Replacement cost<input min="0" step="0.01" type="number" value={replacementCost} onChange={(event) => setReplacementCost(event.target.value)} /></label><label>Expected life months<input min="1" type="number" value={expectedLifeMonths} onChange={(event) => setExpectedLifeMonths(event.target.value)} /></label><label>Replacement due<input type="date" value={replacementDueAt} onChange={(event) => setReplacementDueAt(event.target.value)} /></label><label>Meter unit<select value={meterUnit} onChange={(event) => setMeterUnit(event.target.value)}><option value="hours">Hours</option><option value="cycles">Cycles</option><option value="kilometres">Kilometres</option><option value="units">Units</option></select></label></div><button className="button" disabled={saving} type="submit">Save lifecycle profile</button></form></section> : null}

            <div className="minimal-split">
              <section className="neo-card"><div className="minimal-toolbar"><div><h2>Meter reading</h2><p>Meter plans generate work when their threshold is reached.</p></div></div><form className="grid" onSubmit={recordMeter}><div className="form-grid"><label>Reading<input min={selected.meter_value} step="0.01" type="number" value={meterReading} onChange={(event) => setMeterReading(event.target.value)} /></label><label>Unit<select value={meterUnit} onChange={(event) => setMeterUnit(event.target.value)}><option value="hours">Hours</option><option value="cycles">Cycles</option><option value="kilometres">Kilometres</option><option value="units">Units</option></select></label><label>Source<select value={meterSource} onChange={(event) => setMeterSource(event.target.value)}><option value="manual">Manual</option><option value="service">Service</option><option value="inspection">Inspection</option><option value="sensor">Sensor</option></select></label></div><label>Notes<input value={meterNotes} onChange={(event) => setMeterNotes(event.target.value)} /></label><button className="button secondary" disabled={saving || !meterReading} type="submit">Record reading</button></form><div className="minimal-list minimal-form-section">{meters.slice(0, 8).map((meter) => <div className="minimal-list-item" key={meter.id}><div><strong>{meter.reading} {meter.unit}</strong><p>{meter.notes ?? meter.source}</p></div><small>{new Date(meter.recorded_at).toLocaleString()}</small></div>)}</div></section>
              <section className="neo-card"><div className="minimal-toolbar"><div><h2>Downtime</h2><p>Capture unavailable time for reliability reporting.</p></div></div><form className="grid" onSubmit={recordDowntime}><div className="form-grid"><label>Start<input type="datetime-local" value={downtimeStart} onChange={(event) => setDowntimeStart(event.target.value)} /></label><label>End<input type="datetime-local" value={downtimeEnd} onChange={(event) => setDowntimeEnd(event.target.value)} /></label></div><label>Reason<input value={downtimeReason} onChange={(event) => setDowntimeReason(event.target.value)} /></label><label>Notes<input value={downtimeNotes} onChange={(event) => setDowntimeNotes(event.target.value)} /></label><button className="button secondary" disabled={saving || !downtimeStart || !downtimeEnd} type="submit">Record downtime</button></form><div className="minimal-list minimal-form-section">{downtime.slice(0, 8).map((event) => <div className="minimal-list-item" key={event.id}><div><strong>{event.downtime_minutes} min</strong><p>{event.reason ?? event.notes ?? 'No reason recorded'}</p></div><small>{new Date(event.started_at).toLocaleString()}</small></div>)}</div></section>
            </div>

            <section className="neo-card"><div className="minimal-toolbar"><div><h2>Maintenance exposure</h2><p>Plans and recent work linked to this asset.</p></div><Link className="button secondary" href="/operations/maintenance">Manage plans</Link></div><div className="minimal-list">{plans.length === 0 ? <div className="minimal-empty">No maintenance plans.</div> : plans.map((plan) => <div className="minimal-list-item" key={plan.id}><div><h3>{plan.title}</h3><p>{plan.plan_number} • {plan.trigger_type}</p><small>{plan.next_due_at ? `Next ${new Date(plan.next_due_at).toLocaleString()}` : plan.next_due_meter !== null ? `Next meter ${plan.next_due_meter}` : 'No next trigger'}</small></div><div>{plan.last_generated_work_item_id ? <Link className="button secondary" href={`/work/${plan.last_generated_work_item_id}`}>Open work</Link> : <StatusBadge value={plan.is_active ? 'active' : 'inactive'} />}</div></div>)}</div></section>
          </>}
        </section>
      </div>
    </div>
  );
}
