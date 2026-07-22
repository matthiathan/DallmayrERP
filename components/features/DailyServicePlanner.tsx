'use client';

import { useEffect, useMemo, useState } from 'react';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

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
  can_reschedule: boolean;
};

type Technician = {
  user_id: string;
  display_name: string;
  role: string;
  branch: string;
};

const branches = ['all', 'jhb', 'cpt', 'kzn', 'national'];

function localDateValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

export function DailyServicePlanner() {
  const [scheduleDate, setScheduleDate] = useState(localDateValue());
  const [branch, setBranch] = useState('all');
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState('');
  const [routeNumber, setRouteNumber] = useState('');
  const [routeOrder, setRouteOrder] = useState('');
  const [newDate, setNewDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const selected = useMemo(
    () => items.find((item) => `${item.item_type}:${item.item_id}` === selectedId) ?? null,
    [items, selectedId],
  );

  async function loadPlanner() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [scheduleResult, technicianResult] = await Promise.all([
      client.rpc('list_daily_service_schedule', {
        p_schedule_date: scheduleDate,
        p_branch: branch,
      }),
      client.rpc('list_assignable_technicians'),
    ]);

    const firstError = scheduleResult.error ?? technicianResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setItems((scheduleResult.data ?? []) as ScheduleItem[]);
    setTechnicians((technicianResult.data ?? []) as Technician[]);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    loadPlanner().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the service route plan.');
      setLoading(false);
    });
  }, [scheduleDate, branch]);

  useEffect(() => {
    if (!selected) {
      setAssignedTo('');
      setRouteNumber('');
      setRouteOrder('');
      setNewDate('');
      setRescheduleReason('');
      return;
    }
    setAssignedTo(selected.assigned_to ?? '');
    setRouteNumber(selected.route_number ?? '');
    setRouteOrder(selected.route_order == null ? '' : String(selected.route_order));
    setNewDate(selected.scheduled_date);
    setRescheduleReason('');
  }, [selected]);

  async function saveAssignment() {
    if (!selected || !assignedTo) {
      setError('Select a service item and driver before saving the route assignment.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: saveError } = await getSupabaseClient().rpc('assign_daily_service_item', {
      p_item_type: selected.item_type,
      p_item_id: selected.item_id,
      p_assigned_to: assignedTo,
      p_route_number: routeNumber.trim() || null,
      p_route_order: routeOrder ? Number(routeOrder) : null,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setMessage(`${selected.customer_name ?? 'Service item'} assigned to the selected driver.`);
    await loadPlanner();
  }

  async function rescheduleItem() {
    if (!selected || !newDate || !rescheduleReason.trim()) {
      setError('Select a service item, choose the new date and enter a reschedule reason.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: rescheduleError } = await getSupabaseClient().rpc('reschedule_daily_service_item', {
      p_item_type: selected.item_type,
      p_item_id: selected.item_id,
      p_new_date: newDate,
      p_reason: rescheduleReason.trim(),
    });
    setSaving(false);
    if (rescheduleError) {
      setError(rescheduleError.message);
      return;
    }
    setMessage(`${selected.customer_name ?? 'Service item'} moved to ${new Date(`${newDate}T12:00:00`).toLocaleDateString('en-ZA')}.`);
    setSelectedId(null);
    await loadPlanner();
  }

  const metrics = useMemo(() => ({
    total: items.length,
    monthly: items.filter((item) => item.item_type === 'monthly').length,
    requests: items.filter((item) => item.item_type === 'request').length,
    unassigned: items.filter((item) => !item.assigned_to).length,
    missed: items.filter((item) => item.status === 'missed').length,
  }), [items]);

  const columns = useMemo<EnterpriseColumn<ScheduleItem>[]>(() => [
    {
      id: 'select',
      header: 'Plan',
      filterable: false,
      defaultWidth: 92,
      value: (row) => `${row.item_type}:${row.item_id}`,
      render: (row) => (
        <button
          className={`button secondary compact-action ${selectedId === `${row.item_type}:${row.item_id}` ? 'is-selected' : ''}`}
          onClick={() => setSelectedId(`${row.item_type}:${row.item_id}`)}
          type="button"
        >
          Select
        </button>
      ),
    },
    { id: 'route', header: 'Route', value: (row) => `${row.route_number ?? ''} ${row.route_order ?? ''}`, render: (row) => <span>{row.route_number || 'Unplanned'}{row.route_order == null ? '' : ` · Stop ${row.route_order}`}</span>, defaultWidth: 150 },
    { id: 'driver', header: 'Driver', value: (row) => row.assigned_name ?? '', render: (row) => <span>{row.assigned_name || 'Unassigned'}</span>, defaultWidth: 180 },
    { id: 'customer', header: 'Customer', value: (row) => `${row.customer_name ?? ''} ${row.customer_code ?? ''}`, render: (row) => <strong>{row.customer_name ?? 'Customer not linked'}<small>{row.customer_code ? ` · ${row.customer_code}` : ''}</small></strong>, defaultWidth: 280 },
    { id: 'basis', header: 'Service basis', value: (row) => `${row.item_type} ${row.payment_status}`, render: (row) => <span>{row.item_type === 'monthly' ? 'Paid monthly service' : 'Customer request'}</span>, defaultWidth: 190 },
    { id: 'status', header: 'Status', value: (row) => row.status, render: (row) => <StatusBadge value={row.status} />, defaultWidth: 135 },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase(), defaultWidth: 105 },
    { id: 'address', header: 'Address', value: (row) => row.address ?? '', render: (row) => <span>{row.address || 'No address captured'}</span>, defaultWidth: 330 },
    { id: 'summary', header: 'Work required', value: (row) => row.summary ?? '', defaultWidth: 280 },
  ], [selectedId]);

  return (
    <div className="monthly-service-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={() => loadPlanner()} type="button">{loading ? 'Refreshing…' : 'Refresh daily list'}</button>}
        description="Paid monthly obligations appear automatically after Finance confirms payment. Requested service jobs appear on their due date."
        lastUpdated={lastUpdated}
        title="Clients requiring service"
      >
        <label>Service date
          <div className="service-date-stepper">
            <button aria-label="Previous day" className="button secondary" onClick={() => setScheduleDate((value) => shiftDate(value, -1))} type="button">−1</button>
            <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />
            <button aria-label="Next day" className="button secondary" onClick={() => setScheduleDate((value) => shiftDate(value, 1))} type="button">+1</button>
          </div>
        </label>
        <label>Branch
          <select value={branch} onChange={(event) => setBranch(event.target.value)}>
            {branches.map((item) => <option key={item} value={item}>{item === 'all' ? 'All branches' : item.toUpperCase()}</option>)}
          </select>
        </label>
      </PageToolbar>

      <div className="grid grid-5 monthly-service-kpis">
        <KpiCard label="Clients due" value={metrics.total} helper="All service work on the selected date." />
        <KpiCard label="Paid monthly" value={metrics.monthly} helper="Finance-confirmed monthly services." />
        <KpiCard label="On request" value={metrics.requests} helper="Non-monthly requested work." />
        <KpiCard label="Unassigned" value={metrics.unassigned} helper="Still requiring a driver and route." />
        <KpiCard label="Missed" value={metrics.missed} helper="Past due and not completed." />
      </div>

      <EnterpriseDataTable
        columns={columns}
        defaultPageSize={100}
        emptyMessage={loading ? 'Loading the daily service list…' : 'No clients are scheduled for this date.'}
        getSearchText={(row) => [row.customer_name, row.customer_code, row.address, row.assigned_name, row.route_number, row.summary, row.status].join(' ')}
        rowKey={(row) => `${row.item_type}:${row.item_id}`}
        rows={items}
        searchPlaceholder="Search customer, code, address, driver or route"
      />

      <section className="neo-card monthly-service-editor">
        <div className="minimal-panel-header">
          <div>
            <span className="minimal-kicker">Operations route control</span>
            <h2>{selected ? selected.customer_name ?? 'Selected service item' : 'Select a client from the daily list'}</h2>
            <p>{selected ? `${selected.item_type === 'monthly' ? 'Paid monthly obligation' : 'Customer-requested service'} · ${selected.branch.toUpperCase()}` : 'The route and reschedule controls activate after a row is selected.'}</p>
          </div>
        </div>

        <div className="monthly-service-editor-grid">
          <div className="monthly-service-editor-panel">
            <h3>Assign driver and route</h3>
            <div className="form-grid">
              <label>Driver
                <select disabled={!selected || saving} value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
                  <option value="">Select driver</option>
                  {technicians.map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role} · {technician.branch.toUpperCase()}</option>)}
                </select>
              </label>
              <label>Route number<input disabled={!selected || saving} value={routeNumber} onChange={(event) => setRouteNumber(event.target.value)} placeholder="Example: JHB-2026-07-01-A" /></label>
              <label>Stop order<input disabled={!selected || saving} min="1" type="number" value={routeOrder} onChange={(event) => setRouteOrder(event.target.value)} /></label>
            </div>
            <button className="button" disabled={!selected || !assignedTo || saving} onClick={saveAssignment} type="button">{saving ? 'Saving…' : 'Save route assignment'}</button>
          </div>

          <div className="monthly-service-editor-panel">
            <h3>Reschedule service</h3>
            <div className="form-grid">
              <label>New service date<input disabled={!selected || saving} type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} /></label>
            </div>
            <label>Reason<textarea disabled={!selected || saving} value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} placeholder="Record why the service date changed." /></label>
            <button className="button secondary" disabled={!selected || !newDate || !rescheduleReason.trim() || saving} onClick={rescheduleItem} type="button">Reschedule with audit reason</button>
          </div>
        </div>
      </section>
    </div>
  );
}
