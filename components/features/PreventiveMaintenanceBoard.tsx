'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { CompleteMaintenancePlanCreateForm } from '@/components/features/CompleteMaintenancePlanCreateForm';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AssignableUser, WorkPriority } from '@/types/professional-ops';

type TriggerType = 'calendar' | 'meter' | 'hybrid';

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
  incident_number: string | null;
  machine_id: string;
  customer_code_snapshot: string | null;
  customer_name_snapshot: string | null;
  service_type: string | null;
  service_code: string | null;
  category: string | null;
  sub_category: string | null;
  ticket_case_number: string | null;
  work_order_number: string | null;
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

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function machineLabel(machine: Pick<MachineRelation, 'machine_name' | 'serial_number' | 'machine_barcode'>) {
  return machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine';
}

function isDue(plan: PlanRow) {
  const machine = firstRelation(plan.machines);
  const calendarDue = Boolean(plan.next_due_at && new Date(plan.next_due_at).getTime() <= Date.now());
  const meterDue = Boolean(plan.next_due_meter !== null && machine && Number(machine.meter_value) >= Number(plan.next_due_meter));
  return calendarDue || meterDue;
}

export function PreventiveMaintenanceBoard() {
  const { userDetails } = useAuth();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
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
      if (generateError) setError(generateError.message);
      else if (Number(generated) > 0) setMessage(`${generated} due maintenance work item(s) generated.`);
      else setMessage('No due maintenance work to generate.');
    }

    const [planResult, userResult] = await Promise.all([
      client.from('maintenance_plans')
        .select(`
          id, plan_number, incident_number, machine_id, customer_code_snapshot,
          customer_name_snapshot, service_type, service_code, category, sub_category,
          ticket_case_number, work_order_number, title, description, trigger_type,
          interval_days, interval_meter, next_due_at, next_due_meter, priority,
          estimated_minutes, assigned_to, checklist_template, is_active,
          last_generated_at, last_generated_work_item_id,
          machines(machine_name, serial_number, machine_barcode, branch, meter_value, meter_unit)
        `)
        .order('next_due_at', { ascending: true, nullsFirst: false })
        .limit(500),
      client.rpc('list_assignable_users'),
    ]);

    const firstError = planResult.error ?? userResult.error;
    if (firstError) setError(firstError.message);
    else {
      setPlans((planResult.data ?? []) as PlanRow[]);
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

  async function togglePlan(plan: PlanRow) {
    const { error: updateError } = await getSupabaseClient()
      .from('maintenance_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
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
  const filteredPlans = useMemo(() => {
    const term = search.trim().toLowerCase();
    return plans.filter((plan) => {
      const machine = firstRelation(plan.machines);
      const text = [
        plan.plan_number, plan.incident_number, plan.title, plan.customer_code_snapshot,
        plan.customer_name_snapshot, plan.service_type, plan.service_code, plan.category,
        plan.sub_category, plan.ticket_case_number, plan.work_order_number,
        machine ? machineLabel(machine) : '', machine?.serial_number,
        machine?.machine_barcode, plan.priority, plan.trigger_type,
      ].join(' ').toLowerCase();
      return !term || text.includes(term);
    });
  }, [plans, search]);

  const dueCount = plans.filter((plan) => plan.is_active && isDue(plan)).length;
  const activeCount = plans.filter((plan) => plan.is_active).length;
  const generatedCount = plans.filter((plan) => plan.last_generated_work_item_id).length;

  return (
    <div className="grid maintenance-plan-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <div className="minimal-metric-grid">
        <div className="minimal-metric"><span>Active plans</span><strong>{activeCount}</strong></div>
        <div className="minimal-metric"><span>Due now</span><strong>{dueCount}</strong></div>
        <div className="minimal-metric"><span>Plans with generated work</span><strong>{generatedCount}</strong></div>
      </div>

      {canManage ? <CompleteMaintenancePlanCreateForm onCreated={() => loadPlans(false)} /> : null}

      <PageToolbar
        actions={canManage
          ? <button className="button secondary" disabled={loading || saving} onClick={() => loadPlans(true)} type="button">Generate due work</button>
          : <button className="button secondary" disabled={loading} onClick={() => loadPlans(false)} type="button">Refresh</button>}
        description="Monitor scheduled maintenance and explicitly generate due work. Search accepts incident, plan, customer, machine, ticket, work order, serial or barcode."
        lastUpdated={lastUpdated}
        title="Maintenance plans"
      >
        <label>Search<input autoComplete="off" autoCorrect="off" spellCheck={false} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Incident, plan, customer, machine, ticket or WO" /></label>
      </PageToolbar>

      <div className="minimal-list">
        {filteredPlans.length === 0 ? <div className="minimal-empty">{loading ? 'Loading maintenance plans...' : 'No maintenance plans match this search.'}</div> : filteredPlans.map((plan) => {
          const machine = firstRelation(plan.machines);
          const due = plan.is_active && isDue(plan);
          return (
            <article className="minimal-list-item" key={plan.id}>
              <div>
                <div className="feature-list"><StatusBadge value={plan.is_active ? 'active' : 'inactive'} /><StatusBadge value={due ? 'overdue' : plan.trigger_type} label={due ? 'Due' : plan.trigger_type} /><StatusBadge value={plan.priority} /></div>
                <h3>{plan.title}</h3>
                <p>{plan.plan_number}{plan.incident_number ? ` • Incident ${plan.incident_number}` : ''} • {machine ? machineLabel(machine) : 'Machine unavailable'} • {machine?.branch.toUpperCase() ?? '-'}</p>
                <small>
                  {plan.customer_code_snapshot || plan.customer_name_snapshot ? `${plan.customer_code_snapshot ?? ''} ${plan.customer_name_snapshot ?? ''} • ` : ''}
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
