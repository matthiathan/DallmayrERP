'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type ScheduleItem = {
  item_type: 'monthly' | 'request';
  item_id: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  branch: string;
  scheduled_date: string;
  payment_status: string;
  status: string;
  assigned_to: string | null;
  assigned_name: string | null;
  route_number: string | null;
  route_order: number | null;
  address: string | null;
  summary: string | null;
};

type Technician = {
  user_id: string;
  display_name: string;
  role: string;
  branch: string;
};

type MachineRelation = {
  machine_name: string | null;
  serial_number: string | null;
};

type ServiceJob = {
  id: string;
  job_number: string;
  incident_number: string;
  branch: string;
  assigned_to: string | null;
  priority: string;
  status: string;
  summary: string;
  complaint_details: string;
  due_at: string | null;
  customer_name_snapshot: string | null;
  address_snapshot: string | null;
  machine_id: string | null;
  machines?: MachineRelation | MachineRelation[] | null;
};

type DeliveryOrder = {
  id: string;
  order_number: string;
  branch: string;
  customer_name: string;
  delivery_address: string | null;
  status: string;
  created_at: string;
  dispatched_at: string | null;
  delivered_at: string | null;
};

type CapacityRow = Technician & {
  routeStops: number;
  openJobs: number;
  overdueJobs: number;
  highPriorityJobs: number;
  loadScore: number;
};

const branchOptions = ['all', 'jhb', 'cpt', 'kzn', 'national'] as const;
const openServiceStatuses = ['new', 'assigned', 'in_progress'];
const activeDeliveryStatuses = ['draft', 'picked', 'dispatched', 'delivered'];

function localDateValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function firstRelation<T>(relation: T | T[] | null | undefined): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

function isOverdue(value: string | null) {
  return Boolean(value && new Date(value).getTime() < Date.now());
}

function formatDateTime(value: string | null) {
  if (!value) return 'No due time';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function branchLabel(value: string) {
  if (value === 'all') return 'All branches';
  if (value === 'jhb') return 'Johannesburg';
  if (value === 'cpt') return 'Cape Town';
  if (value === 'kzn') return 'KwaZulu-Natal';
  return 'National';
}

function deliveryRank(status: string) {
  if (status === 'dispatched') return 0;
  if (status === 'picked') return 1;
  if (status === 'draft') return 2;
  return 3;
}

export function OperationsDispatchOverview() {
  const { userDetails } = useAuth();
  const [scheduleDate, setScheduleDate] = useState(localDateValue());
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [serviceJobs, setServiceJobs] = useState<ServiceJob[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const canSelectBranch = userDetails?.branch === 'national';
  const branchScope = canSelectBranch ? selectedBranch : userDetails?.branch ?? 'all';

  const loadDispatch = useCallback(async () => {
    if (!userDetails) return;

    setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    let jobsQuery = client
      .from('service_jobs')
      .select('id, job_number, incident_number, branch, assigned_to, priority, status, summary, complaint_details, due_at, customer_name_snapshot, address_snapshot, machine_id, machines(machine_name, serial_number)')
      .in('status', openServiceStatuses)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(240);

    let deliveryQuery = client
      .from('delivery_orders')
      .select('id, order_number, branch, customer_name, delivery_address, status, created_at, dispatched_at, delivered_at')
      .in('status', activeDeliveryStatuses)
      .order('created_at', { ascending: false })
      .limit(240);

    if (branchScope !== 'all') {
      jobsQuery = jobsQuery.eq('branch', branchScope);
      deliveryQuery = deliveryQuery.eq('branch', branchScope);
    }

    const [scheduleResult, technicianResult, jobsResult, deliveryResult] = await Promise.all([
      client.rpc('list_daily_service_schedule', {
        p_schedule_date: scheduleDate,
        p_branch: branchScope,
      }),
      client.rpc('list_assignable_technicians'),
      jobsQuery,
      deliveryQuery,
    ]);

    const firstError = scheduleResult.error ?? technicianResult.error ?? jobsResult.error ?? deliveryResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setSchedule((scheduleResult.data ?? []) as ScheduleItem[]);
    setTechnicians((technicianResult.data ?? []) as Technician[]);
    setServiceJobs((jobsResult.data ?? []) as ServiceJob[]);
    setDeliveries((deliveryResult.data ?? []) as DeliveryOrder[]);
    setLastUpdated(new Date());
    setLoading(false);
  }, [branchScope, scheduleDate, userDetails]);

  useEffect(() => {
    loadDispatch().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the Operations dispatch overview.');
      setLoading(false);
    });
  }, [loadDispatch]);

  const unplannedItems = useMemo(() => schedule
    .filter((item) => !item.assigned_to || !item.route_number)
    .sort((left, right) => {
      if (Boolean(left.assigned_to) !== Boolean(right.assigned_to)) return left.assigned_to ? 1 : -1;
      return (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER);
    }), [schedule]);

  const serviceExceptions = useMemo(() => serviceJobs
    .filter((job) => !job.assigned_to || isOverdue(job.due_at) || ['high', 'critical'].includes(job.priority) || !job.machine_id)
    .sort((left, right) => {
      const leftScore = (isOverdue(left.due_at) ? 8 : 0) + (!left.assigned_to ? 5 : 0) + (left.priority === 'critical' ? 4 : left.priority === 'high' ? 2 : 0) + (!left.machine_id ? 1 : 0);
      const rightScore = (isOverdue(right.due_at) ? 8 : 0) + (!right.assigned_to ? 5 : 0) + (right.priority === 'critical' ? 4 : right.priority === 'high' ? 2 : 0) + (!right.machine_id ? 1 : 0);
      return rightScore - leftScore;
    }), [serviceJobs]);

  const deliveryPressure = useMemo(() => [...deliveries]
    .sort((left, right) => {
      const rankDifference = deliveryRank(left.status) - deliveryRank(right.status);
      if (rankDifference !== 0) return rankDifference;
      return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    }), [deliveries]);

  const capacityRows = useMemo<CapacityRow[]>(() => technicians
    .filter((technician) => branchScope === 'all' || technician.branch === branchScope || technician.branch === 'national')
    .map((technician) => {
      const routeStops = schedule.filter((item) => item.assigned_to === technician.user_id).length;
      const assignedJobs = serviceJobs.filter((job) => job.assigned_to === technician.user_id);
      const overdueJobs = assignedJobs.filter((job) => isOverdue(job.due_at)).length;
      const highPriorityJobs = assignedJobs.filter((job) => ['high', 'critical'].includes(job.priority)).length;
      const openJobs = assignedJobs.length;
      return {
        ...technician,
        routeStops,
        openJobs,
        overdueJobs,
        highPriorityJobs,
        loadScore: routeStops + openJobs + (overdueJobs * 2) + highPriorityJobs,
      };
    })
    .sort((left, right) => right.loadScore - left.loadScore || left.display_name.localeCompare(right.display_name)), [branchScope, schedule, serviceJobs, technicians]);

  const overdueJobs = serviceJobs.filter((job) => isOverdue(job.due_at)).length;
  const unassignedJobs = serviceJobs.filter((job) => !job.assigned_to).length;
  const dispatchedDeliveries = deliveries.filter((delivery) => delivery.status === 'dispatched').length;
  const scheduledTechnicians = capacityRows.filter((technician) => technician.routeStops > 0 || technician.openJobs > 0).length;

  return (
    <div className="dispatch-overview-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}

      <PageToolbar
        actions={(
          <div className="dispatch-toolbar-actions">
            <Link className="button secondary" href="/operations/service-planning">Route planner</Link>
            <button className="button" disabled={loading} onClick={loadDispatch} type="button">
              {loading ? 'Refreshing…' : 'Refresh dispatch'}
            </button>
          </div>
        )}
        description={`Combined service, delivery and field-capacity pressure for ${branchLabel(branchScope)}.`}
        lastUpdated={lastUpdated}
        title="Operations Dispatch Overview"
      >
        <label>
          Dispatch date
          <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />
        </label>
        <label>
          Branch
          <select disabled={!canSelectBranch} value={branchScope} onChange={(event) => setSelectedBranch(event.target.value)}>
            {branchOptions.map((branch) => <option key={branch} value={branch}>{branchLabel(branch)}</option>)}
          </select>
        </label>
      </PageToolbar>

      {loading ? <HamsterLoader label="Loading dispatch pressure" /> : null}

      {!loading ? (
        <>
          <section aria-label="Dispatch summary" className="dispatch-kpi-grid">
            <KpiCard label="Stops scheduled" value={schedule.length} helper="Monthly and requested work for the selected date." />
            <KpiCard label="Route gaps" value={unplannedItems.length} helper="Stops missing a driver or route number." />
            <KpiCard label="Service overdue" value={overdueJobs} helper="Open service jobs beyond their due time." />
            <KpiCard label="Jobs unassigned" value={unassignedJobs} helper="Open service jobs still needing a technician." />
            <KpiCard label="Deliveries dispatched" value={dispatchedDeliveries} helper="Orders currently out for delivery." />
            <KpiCard label="Field staff loaded" value={scheduledTechnicians} helper="Technicians with route stops or open jobs." />
          </section>

          <section className="dispatch-pressure-grid">
            <article className="neo-card dispatch-pressure-panel">
              <div className="dispatch-panel-header">
                <div>
                  <span className="minimal-kicker">Route gaps</span>
                  <h2>Unplanned service work</h2>
                  <p>Stops requiring a driver or route number.</p>
                </div>
                <Link href="/operations/service-planning">Open planner</Link>
              </div>
              <div className="dispatch-card-list">
                {unplannedItems.length === 0 ? <div className="empty-state compact-empty-state">Every service stop has a driver and route.</div> : null}
                {unplannedItems.slice(0, 12).map((item) => (
                  <div className="dispatch-pressure-card" key={`${item.item_type}:${item.item_id}`}>
                    <div className="dispatch-card-heading">
                      <strong>{item.customer_name ?? 'Customer not linked'}</strong>
                      <StatusBadge value={item.status} />
                    </div>
                    <p>{item.customer_code || item.branch.toUpperCase()} · {item.address || 'No address captured'}</p>
                    <div className="dispatch-card-meta">
                      <span>{item.item_type === 'monthly' ? 'Paid monthly' : 'Requested service'}</span>
                      <span>{item.assigned_name || 'Driver unassigned'}</span>
                      <span>{item.route_number ? `${item.route_number}${item.route_order ? ` · Stop ${item.route_order}` : ''}` : 'Route missing'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="neo-card dispatch-pressure-panel">
              <div className="dispatch-panel-header">
                <div>
                  <span className="minimal-kicker">Service exceptions</span>
                  <h2>Jobs requiring intervention</h2>
                  <p>Overdue, urgent, unassigned or unlinked-machine work.</p>
                </div>
                <Link href="/operations/service-jobs">Open call log</Link>
              </div>
              <div className="dispatch-card-list">
                {serviceExceptions.length === 0 ? <div className="empty-state compact-empty-state">No service exceptions require intervention.</div> : null}
                {serviceExceptions.slice(0, 12).map((job) => {
                  const machine = firstRelation(job.machines);
                  return (
                    <Link className="dispatch-pressure-card dispatch-card-link" href={`/operations/service-jobs?job=${encodeURIComponent(job.id)}`} key={job.id}>
                      <div className="dispatch-card-heading">
                        <strong>{job.job_number}</strong>
                        <StatusBadge value={isOverdue(job.due_at) ? 'overdue' : job.priority} />
                      </div>
                      <p>{job.customer_name_snapshot || 'Customer not linked'} · Incident {job.incident_number}</p>
                      <div className="dispatch-card-meta">
                        <span>{job.assigned_to ? 'Technician assigned' : 'Unassigned'}</span>
                        <span>{machine?.machine_name ?? machine?.serial_number ?? 'Machine not linked'}</span>
                        <span>{formatDateTime(job.due_at)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </article>

            <article className="neo-card dispatch-pressure-panel">
              <div className="dispatch-panel-header">
                <div>
                  <span className="minimal-kicker">Delivery pressure</span>
                  <h2>Open delivery movement</h2>
                  <p>Orders waiting to move through fulfilment and proof.</p>
                </div>
                <Link href="/operations/deliveries">Open board</Link>
              </div>
              <div className="dispatch-card-list">
                {deliveryPressure.length === 0 ? <div className="empty-state compact-empty-state">No active deliveries are in scope.</div> : null}
                {deliveryPressure.slice(0, 12).map((delivery) => (
                  <Link className="dispatch-pressure-card dispatch-card-link" href={`/operations/deliveries?order=${encodeURIComponent(delivery.id)}`} key={delivery.id}>
                    <div className="dispatch-card-heading">
                      <strong>{delivery.order_number}</strong>
                      <StatusBadge value={delivery.status} />
                    </div>
                    <p>{delivery.customer_name} · {delivery.branch.toUpperCase()}</p>
                    <div className="dispatch-card-meta">
                      <span>{delivery.delivery_address || 'No delivery address'}</span>
                      <span>{delivery.dispatched_at ? `Dispatched ${formatDateTime(delivery.dispatched_at)}` : `Created ${formatDateTime(delivery.created_at)}`}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </article>
          </section>

          <section className="neo-card dispatch-capacity-panel">
            <div className="dispatch-panel-header">
              <div>
                <span className="minimal-kicker">Field capacity</span>
                <h2>Technician workload</h2>
                <p>Route stops and open service jobs by assignable field user.</p>
              </div>
              <span>{capacityRows.length} technician(s)</span>
            </div>

            {capacityRows.length === 0 ? (
              <div className="empty-state compact-empty-state">No assignable technicians are available in this branch scope.</div>
            ) : (
              <div className="dispatch-capacity-grid">
                {capacityRows.map((technician) => {
                  const loadState = technician.overdueJobs > 0 || technician.loadScore >= 9
                    ? 'overloaded'
                    : technician.loadScore > 0 ? 'busy' : 'available';
                  return (
                    <article className="dispatch-capacity-card" key={technician.user_id}>
                      <div className="dispatch-card-heading">
                        <div>
                          <strong>{technician.display_name || technician.role}</strong>
                          <small>{technician.role.replace(/_/g, ' ')} · {technician.branch.toUpperCase()}</small>
                        </div>
                        <StatusBadge value={loadState} />
                      </div>
                      <div className="dispatch-capacity-metrics">
                        <div><span>Route stops</span><strong>{technician.routeStops}</strong></div>
                        <div><span>Open jobs</span><strong>{technician.openJobs}</strong></div>
                        <div><span>Overdue</span><strong>{technician.overdueJobs}</strong></div>
                        <div><span>High priority</span><strong>{technician.highPriorityJobs}</strong></div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
