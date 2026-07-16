'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type MachineOption = { id: string; machine_name: string | null; serial_number: string | null; machine_barcode: string | null; branch: Branch; meter_value: number | null; meter_unit: string | null };
type PlanRow = { id: string; plan_number: string; machine_id: string; title: string; description: string | null; trigger_type: 'calendar' | 'meter' | 'hybrid'; interval_days: number | null; interval_meter: number | null; next_due_at: string | null; next_due_meter: number | null; priority: string; estimated_minutes: number | null; checklist_template: Array<{ label: string; sort_order: number; required: boolean }>; is_active: boolean; last_generated_at: string | null; machines?: { machine_name: string | null; serial_number: string | null } | Array<{ machine_name: string | null; serial_number: string | null }> | null };

const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

function relationName(value: PlanRow['machines']) {
  const machine = Array.isArray(value) ? value[0] : value;
  return machine?.machine_name ?? machine?.serial_number ?? 'Machine';
}

export function MinimalMaintenancePlanner() {
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [branch, setBranch] = useState<Branch>('jhb');
  const [machineId, setMachineId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<'calendar' | 'meter' | 'hybrid'>('calendar');
  const [intervalDays, setIntervalDays] = useState(90);
  const [intervalMeter, setIntervalMeter] = useState(0);
  const [nextDueAt, setNextDueAt] = useState('');
  const [nextDueMeter, setNextDueMeter] = useState(0);
  const [priority, setPriority] = useState('medium');
  const [estimatedMinutes, setEstimatedMinutes] = useState(60);
  const [checklistText, setChecklistText] = useState('Inspect machine condition\nClean internal components\nTest operation\nRecord meter reading');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPlanner() {
    setError(null);
    const client = getSupabaseClient();
    const [machineResult, planResult] = await Promise.all([
      client.from('machines').select('id, machine_name, serial_number, machine_barcode, branch, meter_value, meter_unit').order('machine_name').limit(2000),
      client.from('maintenance_plans').select('id, plan_number, machine_id, title, description, trigger_type, interval_days, interval_meter, next_due_at, next_due_meter, priority, estimated_minutes, checklist_template, is_active, last_generated_at, machines(machine_name, serial_number)').order('next_due_at', { ascending: true }).limit(500),
    ]);
    const firstError = machineResult.error ?? planResult.error;
    if (firstError) throw firstError;
    setMachines((machineResult.data ?? []) as MachineOption[]);
    setPlans((planResult.data ?? []) as PlanRow[]);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadPlanner().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load maintenance plans.'));
  }, []);

  const visibleMachines = useMemo(() => machines.filter((machine) => branch === 'national' || machine.branch === branch), [branch, machines]);
  const filteredPlans = useMemo(() => {
    const term = search.trim().toLowerCase();
    return plans.filter((plan) => !term || [plan.plan_number, plan.title, relationName(plan.machines), plan.trigger_type, plan.priority].join(' ').toLowerCase().includes(term));
  }, [plans, search]);

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!machineId || !title.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const checklist = checklistText.split('\n').map((line) => line.trim()).filter(Boolean).map((label, index) => ({ label, sort_order: index, required: true }));
    const planNumber = `PM-${branch.toUpperCase()}-${Date.now()}`;
    const { error: createError } = await getSupabaseClient().from('maintenance_plans').insert({
      plan_number: planNumber,
      machine_id: machineId,
      title: title.trim(),
      description: description.trim() || null,
      trigger_type: triggerType,
      interval_days: triggerType === 'meter' ? null : Number(intervalDays) || null,
      interval_meter: triggerType === 'calendar' ? null : Number(intervalMeter) || null,
      next_due_at: triggerType === 'meter' || !nextDueAt ? null : new Date(nextDueAt).toISOString(),
      next_due_meter: triggerType === 'calendar' ? null : Number(nextDueMeter) || null,
      priority,
      estimated_minutes: Number(estimatedMinutes) || null,
      checklist_template: checklist,
      is_active: true,
    });
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setMessage(`${planNumber} created.`);
    setTitle('');
    setDescription('');
    await loadPlanner();
  }

  async function generateDue(planId?: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    const { data, error: generateError } = await getSupabaseClient().rpc('generate_due_maintenance_work', { p_plan_id: planId ?? null });
    setSaving(false);
    if (generateError) {
      setError(generateError.message);
      return;
    }
    setMessage(`${data ?? 0} maintenance work item(s) generated.`);
    await loadPlanner();
  }

  async function togglePlan(plan: PlanRow) {
    const { error: updateError } = await getSupabaseClient().from('maintenance_plans').update({ is_active: !plan.is_active, updated_at: new Date().toISOString() }).eq('id', plan.id);
    if (updateError) setError(updateError.message);
    else await loadPlanner();
  }

  return (
    <div className="minimal-stage">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <section className="minimal-panel">
        <div className="minimal-panel-header"><div><span className="minimal-kicker">Preventive maintenance</span><h2>New plan</h2><p>Create calendar, meter or hybrid maintenance schedules.</p></div></div>
        <form className="minimal-form" onSubmit={createPlan}>
          <div className="minimal-grid-3">
            <label>Branch<select value={branch} onChange={(event) => { setBranch(event.target.value as Branch); setMachineId(''); }}>{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            <label>Machine<select required value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">Select machine</option>{visibleMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Machine'} — {machine.branch.toUpperCase()}</option>)}</select></label>
            <label>Trigger<select value={triggerType} onChange={(event) => setTriggerType(event.target.value as 'calendar' | 'meter' | 'hybrid')}><option value="calendar">Calendar</option><option value="meter">Meter</option><option value="hybrid">Calendar + meter</option></select></label>
          </div>
          <div className="minimal-grid-3">
            <label>Plan title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label>
            <label>Estimated minutes<input min="1" type="number" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} /></label>
          </div>
          <div className="minimal-grid-3">
            {triggerType !== 'meter' ? <label>Interval days<input min="1" type="number" value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} /></label> : null}
            {triggerType !== 'meter' ? <label>Next due<input type="datetime-local" value={nextDueAt} onChange={(event) => setNextDueAt(event.target.value)} /></label> : null}
            {triggerType !== 'calendar' ? <label>Meter interval<input min="1" type="number" value={intervalMeter} onChange={(event) => setIntervalMeter(Number(event.target.value))} /></label> : null}
            {triggerType !== 'calendar' ? <label>Next meter due<input min="0" type="number" value={nextDueMeter} onChange={(event) => setNextDueMeter(Number(event.target.value))} /></label> : null}
          </div>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label>Checklist template<textarea rows={6} value={checklistText} onChange={(event) => setChecklistText(event.target.value)} /><small>One required step per line.</small></label>
          <button className="button" disabled={saving || !machineId || !title.trim()} type="submit">{saving ? 'Saving...' : 'Create maintenance plan'}</button>
        </form>
      </section>

      <PageToolbar actions={<><button className="button" disabled={saving} onClick={() => generateDue()} type="button">Generate due work</button><button className="button secondary" onClick={loadPlanner} type="button">Refresh</button></>} description="Review schedules and generate structured work with reusable checklists." lastUpdated={lastUpdated} title="Maintenance plans"><label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Plan, machine or priority" /></label></PageToolbar>

      <section className="minimal-list">
        {filteredPlans.length === 0 ? <div className="minimal-empty">No maintenance plans found.</div> : filteredPlans.map((plan) => {
          const due = Boolean(plan.next_due_at && new Date(plan.next_due_at).getTime() <= Date.now());
          return <article className="minimal-row" key={plan.id}>
            <div className="minimal-row-main"><span className="minimal-kicker">{plan.plan_number}</span><h3>{plan.title}</h3><p>{relationName(plan.machines)} • {plan.trigger_type} • {plan.estimated_minutes ?? '-'} min</p></div>
            <div className="minimal-row-meta"><StatusBadge value={plan.priority} /><StatusBadge value={plan.is_active ? 'active' : 'inactive'} />{due ? <StatusBadge value="overdue" label="Due" /> : null}<span>{plan.next_due_at ? new Date(plan.next_due_at).toLocaleString() : plan.next_due_meter ? `Meter ${plan.next_due_meter}` : 'No next due value'}</span></div>
            <div className="minimal-row-actions"><button className="button secondary" disabled={saving} onClick={() => generateDue(plan.id)} type="button">Generate</button><button className="button secondary" onClick={() => togglePlan(plan)} type="button">{plan.is_active ? 'Pause' : 'Activate'}</button></div>
          </article>;
        })}
      </section>
    </div>
  );
}
