'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AssignableUser, WorkPriority } from '@/types/professional-ops';

type TriggerType = 'calendar' | 'meter' | 'hybrid';
type MachineOption = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  branch: string;
  meter_value: number;
  meter_unit: string;
};
type MachineRelation = {
  machine_name: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  branch: string;
  meter_value: number;
  meter_unit: string;
};
type PlanRow = {
  id: string;
  plan_number: string;
  machine_id: string;
  title: string;
  description: string | null;
  trigger_type: TriggerType;
  interval_days: number | null;
  interval_meter: number | null;
  next_due_at: string | null;
  next_due_meter: number | null;
  priority: WorkPriority;
  estimated_minutes: number | null;
  assigned_to: string | null;
  checklist_template: Array<{ label?: string; required?: boolean; sort_order?: number }>;
  is_active: boolean;
  last_generated_at: string | null;
  last_generated_work_item_id: string | null;
  machines?: MachineRelation | MachineRelation[] | null;
};

const priorities: WorkPriority[] = ['low', 'medium', 'high', 'critical'];

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function machineLabel(machine: Pick<MachineOption, 'machine_name' | 'serial_number' | 'machine_barcode'>) {
  return machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine';
}

function machineOptionLabel(machine: MachineOption) {
  const code = machine.serial_number ?? machine.machine_barcode ?? 'No serial or barcode';
  return `${machineLabel(machine)} — ${code} — ${machine.branch.toUpperCase()}`;
}

function isDue(plan: PlanRow) {
  const machine = firstRelation(plan.machines);
  const calendarDue = Boolean(plan.next_due_at && new Date(plan.next_due_at).getTime() <= Date.now());
  const meterDue = Boolean(plan.next_due_meter !== null && machine && Number(machine.meter_value) >= Number(plan.next_due_meter));
  return calendarDue || meterDue;
}

export function PreventiveMaintenanceBoard() {
  const { businessUser, userDetails } = useAuth();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [machineSearch, setMachineSearch] = useState('');
  const [machineId, setMachineId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('calendar');
  const [intervalDays, setIntervalDays] = useState(90);
  const [intervalMeter, setIntervalMeter] = useState(250);
  const [nextDueAt, setNextDueAt] = useState('');
  const [nextDueMeter, setNextDueMeter] = useState('');
  const [priority, setPriority] = useState<WorkPriority>('medium');
  const [estimatedMinutes, setEstimatedMinutes] = useState(60);
  const [assignedTo, setAssignedTo] = useState('');
  const [checklistText, setChecklistText] = useState('Inspect machine condition\nClean and test components\nRecord meter reading\nConfirm machine is operational');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManage = ['admin', 'operations'].includes(userDetails?.role ?? '');

  async function loadPlans(generateDue = false) {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    if (generateDue && canManage) {
      const { data: generated, error: generateError } = await client.rpc('generate_due_maintenance_work', { p_plan_id: null });
      if (generateError) {
        setError(generateError.message);
      } else if (Number(generated) > 0) {
        setMessage(`${generated} due maintenance work item(s) generated.`);
      } else {
        setMessage('No due maintenance work to generate.');
      }
    }

    const [planResult, machineResult, userResult] = await Promise.all([
      client.from('maintenance_plans')
        .select('id, plan_number, machine_id, title, description, trigger_type, interval_days, interval_meter, next_due_at, next_due_meter, priority, estimated_minutes, assigned_to, checklist_template, is_active, last_generated_at, last_generated_work_item_id, machines(machine_name, serial_number, machine_barcode, branch, meter_value, meter_unit)')
        .order('next_due_at', { ascending: true, nullsFirst: false })
        .limit(500),
      client.from('machines')
        .select('id, machine_name, serial_number, machine_barcode, branch, meter_value, meter_unit')
        .not('status', 'eq', 'retired')
        .order('machine_name')
        .limit(1500),
      client.rpc('list_assignable_users'),
    ]);

    const firstError = planResult.error ?? machineResult.error ?? userResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setPlans((planResult.data ?? []) as PlanRow[]);
      setMachines((machineResult.data ?? []) as MachineOption[]);
      setUsers((userResult.data ?? []) as AssignableUser[]);
      setLastUpdated(new Date());
    }
    setLoading(false);
  }

  useEffect(() => {
    loadPlans(false).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load preventive maintenance.');
      setLoading(false);
    });
  }, [canManage]);

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || !machineId || !title.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const checklist = checklistText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label, index) => ({ label, required: true, sort_order: index }));

    const payload = {
      plan_number: `PM-${Date.now()}`,
      machine_id: machineId,
      title: title.trim(),
      description: description.trim() || null,
      trigger_type: triggerType,
      interval_days: triggerType === 'meter' ? null : Number(intervalDays),
      interval_meter: triggerType === 'calendar' ? null : Number(intervalMeter),
      next_due_at: triggerType === 'meter' || !nextDueAt ? null : new Date(nextDueAt).toISOString(),
      next_due_meter: triggerType === 'calendar' || !nextDueMeter ? null : Number(nextDueMeter),
      priority,
      estimated_minutes: Number(estimatedMinutes) || null,
      assigned_to: assignedTo || null,
      checklist_template: checklist,
      created_by: businessUser.id,
    };

    const { error: createError } = await getSupabaseClient().from('maintenance_plans').insert(payload);
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }

    setMessage('Preventive maintenance plan created. Use Generate due work when ready to create work items.');
    setTitle('');
    setDescription('');
    setMachineSearch('');
    setMachineId('');
    setNextDueAt('');
    setNextDueMeter('');
    setAssignedTo('');
    await loadPlans(false);
  }

  async function togglePlan(plan: PlanRow) {
    const { error: updateError } = await getSupabaseClient().from('maintenance_plans').update({ is_active: !plan.is_active, updated_at: new Date().toISOString() }).eq('id', plan.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadPlans(false);
  }

  async function generatePlan(plan: PlanRow) {
    setSaving(true);
    setError(null);
    const { data, error: generateError } = await getSupabaseClient().rpc('generate_due_maintenance_work', { p_plan_id: plan.id });
    setSaving(false);
    if (generateError) {
      setError(generateError.message);
      return;
    }
    setMessage(Number(data) > 0 ? 'Maintenance work generated.' : 'This plan is not due or already has open work.');
    await loadPlans(false);
  }

  const userMap = useMemo(() => new Map(users.map((user) => [user.user_id, user])), [users]);
  const filteredMachines = useMemo(() => {
    const term = machineSearch.trim().toLowerCase();
    if (!term) return machines;
    return machines.filter((machine) => [machine.machine_name, machine.serial_number, machine.machine_barcode, machine.branch].join(' ').toLowerCase().includes(term));
  }, [machineSearch, machines]);
  const filteredPlans = useMemo(() => {
    const term = search.trim().toLowerCase();
    return plans.filter((plan) => {
      const machine = firstRelation(plan.machines);
      const text = [plan.plan_number, plan.title, machine ? machineLabel(machine) : '', machine?.serial_number, machine?.machine_barcode, plan.priority, plan.trigger_type].join(' ').toLowerCase();
      return !term || text.includes(term);
    });
  }, [plans, search]);

  const dueCount = plans.filter((plan) => plan.is_active && isDue(plan)).length;
  const activeCount = plans.filter((plan) => plan.is_active).length;
  const generatedCount = plans.filter((plan) => plan.last_generated_work_item_id).length;

  return (
    <div className="grid">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="minimal-metric-grid">
        <div className="minimal-metric"><span>Active plans</span><strong>{activeCount}</strong></div>
        <div className="minimal-metric"><span>Due now</span><strong>{dueCount}</strong></div>
        <div className="minimal-metric"><span>Plans with generated work</span><strong>{generatedCount}</strong></div>
      </div>

      {canManage ? (
        <section className="neo-card">
          <div className="minimal-toolbar">
            <div><h2>New maintenance plan</h2><p>Find the machine using any part of its name, serial number, barcode or branch before selecting it.</p></div>
          </div>
          <form className="grid" onSubmit={createPlan}>
            <div className="form-grid">
              <label>Find machine<input autoComplete="off" autoCorrect="off" spellCheck={false} type="search" value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} placeholder="Part of machine, serial, barcode or branch" /></label>
              <label>Machine<select required value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">{filteredMachines.length ? 'Select machine' : 'No machines match the search'}</option>{filteredMachines.map((machine) => <option key={machine.id} value={machine.id}>{machineOptionLabel(machine)}</option>)}</select><small className="field-note">{filteredMachines.length.toLocaleString()} matching machine(s).</small></label>
              <label>Plan title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Quarterly preventive service" /></label>
              <label>Trigger<select value={triggerType} onChange={(event) => setTriggerType(event.target.value as TriggerType)}><option value="calendar">Calendar</option><option value="meter">Meter</option><option value="hybrid">Calendar or meter</option></select></label>
              {triggerType !== 'meter' ? <label>Interval days<input min="1" type="number" value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} /></label> : null}
              {triggerType !== 'calendar' ? <label>Meter interval<input min="1" step="0.01" type="number" value={intervalMeter} onChange={(event) => setIntervalMeter(Number(event.target.value))} /></label> : null}
              {triggerType !== 'meter' ? <label>First due date<input type="datetime-local" value={nextDueAt} onChange={(event) => setNextDueAt(event.target.value)} /></label> : null}
              {triggerType !== 'calendar' ? <label>First due meter<input min="0" step="0.01" type="number" value={nextDueMeter} onChange={(event) => setNextDueMeter(event.target.value)} /></label> : null}
              <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as WorkPriority)}>{priorities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label>Estimated minutes<input min="1" type="number" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} /></label>
              <label>Default assignee<select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">Unassigned</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name || user.role} — {user.branch.toUpperCase()}</option>)}</select></label>
            </div>
            <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Checklist steps, one per line<textarea rows={6} value={checklistText} onChange={(event) => setChecklistText(event.target.value)} /></label>
            <button className="button" disabled={saving || !machineId || !title.trim()} type="submit">{saving ? 'Saving...' : 'Create plan'}</button>
          </form>
        </section>
      ) : null}

      <PageToolbar
        actions={canManage ? <button className="button secondary" disabled={loading || saving} onClick={() => loadPlans(true)} type="button">Generate due work</button> : <button className="button secondary" disabled={loading} onClick={() => loadPlans(false)} type="button">Refresh</button>}
        description="Monitor scheduled work and explicitly generate due maintenance tasks. The search accepts any part of a plan, machine, serial or barcode."
        lastUpdated={lastUpdated}
        title="Maintenance plans"
      >
        <label>Search<input autoComplete="off" autoCorrect="off" spellCheck={false} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Part of plan, machine, serial, barcode or priority" /></label>
      </PageToolbar>

      <div className="minimal-list">
        {filteredPlans.length === 0 ? <div className="minimal-empty">{loading ? 'Loading maintenance plans...' : 'No maintenance plans match this partial search.'}</div> : filteredPlans.map((plan) => {
          const machine = firstRelation(plan.machines);
          const due = plan.is_active && isDue(plan);
          return (
            <article className="minimal-list-item" key={plan.id}>
              <div>
                <div className="feature-list"><StatusBadge value={plan.is_active ? 'active' : 'inactive'} /><StatusBadge value={due ? 'overdue' : plan.trigger_type} label={due ? 'Due' : plan.trigger_type} /><StatusBadge value={plan.priority} /></div>
                <h3>{plan.title}</h3>
                <p>{plan.plan_number} • {machine ? machineLabel(machine) : 'Machine unavailable'} • {machine?.branch.toUpperCase() ?? '-'}</p>
                <small>
                  {plan.next_due_at ? `Next date ${new Date(plan.next_due_at).toLocaleString()}` : 'No calendar date'}
                  {plan.next_due_meter !== null ? ` • Next meter ${plan.next_due_meter} ${machine?.meter_unit ?? ''}` : ''}
                  {plan.assigned_to ? ` • ${userMap.get(plan.assigned_to)?.display_name ?? 'Assigned'}` : ' • Unassigned'}
                </small>
              </div>
              <div className="action-row">
                {plan.last_generated_work_item_id ? <Link className="button secondary" href={`/work/${plan.last_generated_work_item_id}`}>Open work</Link> : null}
                {canManage ? <button className="button secondary" disabled={saving || !due} onClick={() => generatePlan(plan)} type="button">Generate</button> : null}
                {canManage ? <button className="button secondary" disabled={saving} onClick={() => togglePlan(plan)} type="button">{plan.is_active ? 'Pause' : 'Activate'}</button> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
