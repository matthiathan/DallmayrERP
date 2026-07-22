'use client';

import { useEffect, useMemo, useState } from 'react';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type ServicePlanRow = {
  service_plan_id: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string;
  branch: string;
  imported_service_days: string | null;
  service_mode: 'monthly' | 'on_request' | null;
  plan_status: 'pending_finance_review' | 'active' | 'suspended' | 'ended' | null;
  monthly_fee: number | null;
  preferred_day_of_month: number | null;
  service_window_days: number | null;
  finance_verified_at: string | null;
  notes: string | null;
};

type CoverageRow = {
  service_plan_id: string;
  customer_id: string;
  customer_code: string | null;
  customer_name: string;
  branch: string;
  monthly_fee: number | null;
  payment_status: string;
  payment_amount: number | null;
  payment_reference: string | null;
  scheduled_date: string | null;
  obligation_status: string;
  completed_at: string | null;
  completion_source: string | null;
  completion_reference: string | null;
  paid_not_serviced: boolean;
};

const branches = ['all', 'jhb', 'cpt', 'kzn', 'national'];
const planStatuses = ['all', 'pending_finance_review', 'active', 'suspended', 'ended', 'unclassified'];
const paymentStatuses = ['paid', 'pending', 'unpaid', 'refunded', 'waived'];

function monthValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return `${local.toISOString().slice(0, 7)}-01`;
}

function money(value: number | null | undefined) {
  if (value == null) return 'Not captured';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 2 }).format(value);
}

function statusLabel(value: string | null | undefined) {
  return (value ?? 'unclassified').replace(/_/g, ' ');
}

export function FinanceServiceCoverage() {
  const [serviceMonth, setServiceMonth] = useState(monthValue());
  const [branch, setBranch] = useState('all');
  const [search, setSearch] = useState('');
  const [planStatus, setPlanStatus] = useState('pending_finance_review');
  const [plans, setPlans] = useState<ServicePlanRow[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [serviceMode, setServiceMode] = useState<'monthly' | 'on_request'>('monthly');
  const [status, setStatus] = useState<'pending_finance_review' | 'active' | 'suspended' | 'ended'>('pending_finance_review');
  const [monthlyFee, setMonthlyFee] = useState('');
  const [preferredDay, setPreferredDay] = useState('15');
  const [windowDays, setWindowDays] = useState('7');
  const [planNotes, setPlanNotes] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.customer_id === selectedCustomerId) ?? null,
    [plans, selectedCustomerId],
  );

  async function loadData() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [plansResult, coverageResult] = await Promise.all([
      client.rpc('list_customer_service_plans', {
        p_search: search.trim() || null,
        p_branch: branch,
        p_status: planStatus,
        p_limit: 1000,
      }),
      client.rpc('list_finance_service_coverage', {
        p_service_month: serviceMonth,
        p_branch: branch,
        p_search: search.trim() || null,
      }),
    ]);

    const firstError = plansResult.error ?? coverageResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setPlans((plansResult.data ?? []) as ServicePlanRow[]);
    setCoverage((coverageResult.data ?? []) as CoverageRow[]);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadData().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load monthly service coverage.');
        setLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [serviceMonth, branch, search, planStatus]);

  useEffect(() => {
    if (!selectedPlan) return;
    setServiceMode(selectedPlan.service_mode ?? 'monthly');
    setStatus(selectedPlan.plan_status ?? 'pending_finance_review');
    setMonthlyFee(selectedPlan.monthly_fee == null ? '' : String(selectedPlan.monthly_fee));
    setPreferredDay(String(selectedPlan.preferred_day_of_month ?? 15));
    setWindowDays(String(selectedPlan.service_window_days ?? 7));
    setPlanNotes(selectedPlan.notes ?? '');
    setPaymentAmount(selectedPlan.monthly_fee == null ? '' : String(selectedPlan.monthly_fee));
    setPaymentReference('');
    setPaymentNotes('');
  }, [selectedPlan]);

  async function savePlan() {
    if (!selectedPlan) {
      setError('Select a customer before saving the service basis.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: saveError } = await getSupabaseClient().rpc('save_customer_service_plan', {
      p_customer_id: selectedPlan.customer_id,
      p_service_mode: serviceMode,
      p_status: status,
      p_monthly_fee: monthlyFee ? Number(monthlyFee) : null,
      p_preferred_day: preferredDay ? Number(preferredDay) : null,
      p_window_days: windowDays ? Number(windowDays) : 7,
      p_effective_from: null,
      p_effective_to: null,
      p_notes: planNotes.trim() || null,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setMessage(`${selectedPlan.customer_name} service basis saved as ${serviceMode === 'monthly' ? 'monthly' : 'on request'}.`);
    await loadData();
  }

  async function recordPayment() {
    if (!selectedPlan?.service_plan_id) {
      setError('Save and activate the monthly service plan before recording payment.');
      return;
    }
    if (selectedPlan.service_mode !== 'monthly' && serviceMode !== 'monthly') {
      setError('Payments can only generate service obligations for monthly plans.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: paymentError } = await getSupabaseClient().rpc('record_customer_service_payment', {
      p_service_plan_id: selectedPlan.service_plan_id,
      p_service_month: serviceMonth,
      p_payment_status: paymentStatus,
      p_amount: paymentAmount ? Number(paymentAmount) : null,
      p_reference: paymentReference.trim() || null,
      p_paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null,
      p_notes: paymentNotes.trim() || null,
    });
    setSaving(false);
    if (paymentError) {
      setError(paymentError.message);
      return;
    }
    setMessage(`${selectedPlan.customer_name} payment status recorded for ${new Date(`${serviceMonth}T12:00:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}.`);
    await loadData();
  }

  const metrics = useMemo(() => ({
    activePlans: coverage.length,
    paid: coverage.filter((row) => row.payment_status === 'paid').length,
    serviced: coverage.filter((row) => row.obligation_status === 'completed').length,
    missed: coverage.filter((row) => row.paid_not_serviced).length,
    unrecorded: coverage.filter((row) => row.payment_status === 'not_recorded').length,
  }), [coverage]);

  const planColumns = useMemo<EnterpriseColumn<ServicePlanRow>[]>(() => [
    {
      id: 'select',
      header: 'Review',
      filterable: false,
      defaultWidth: 96,
      value: (row) => row.customer_id,
      render: (row) => <button className={`button secondary compact-action ${selectedCustomerId === row.customer_id ? 'is-selected' : ''}`} onClick={() => setSelectedCustomerId(row.customer_id)} type="button">Select</button>,
    },
    { id: 'customer', header: 'Customer', value: (row) => `${row.customer_name} ${row.customer_code ?? ''}`, render: (row) => <strong>{row.customer_name}<small>{row.customer_code ? ` · ${row.customer_code}` : ''}</small></strong>, defaultWidth: 300 },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase(), defaultWidth: 105 },
    { id: 'source', header: 'Imported service days', value: (row) => row.imported_service_days ?? '', render: (row) => <span>{row.imported_service_days || 'Not recorded'}</span>, defaultWidth: 165 },
    { id: 'mode', header: 'Service basis', value: (row) => row.service_mode ?? 'unclassified', render: (row) => <span>{row.service_mode === 'monthly' ? 'Monthly' : row.service_mode === 'on_request' ? 'On request' : 'Unclassified'}</span>, defaultWidth: 145 },
    { id: 'status', header: 'Finance status', value: (row) => row.plan_status ?? 'unclassified', render: (row) => <StatusBadge value={row.plan_status ?? 'unclassified'} label={statusLabel(row.plan_status)} />, defaultWidth: 185 },
    { id: 'fee', header: 'Monthly fee', value: (row) => row.monthly_fee ?? '', render: (row) => <strong>{money(row.monthly_fee)}</strong>, defaultWidth: 155 },
    { id: 'day', header: 'Preferred day', value: (row) => row.preferred_day_of_month ?? '', render: (row) => <span>{row.preferred_day_of_month ? `Day ${row.preferred_day_of_month}` : 'Not set'}</span>, defaultWidth: 145 },
  ], [selectedCustomerId]);

  const coverageColumns = useMemo<EnterpriseColumn<CoverageRow>[]>(() => [
    { id: 'customer', header: 'Customer', value: (row) => `${row.customer_name} ${row.customer_code ?? ''}`, render: (row) => <strong>{row.customer_name}<small>{row.customer_code ? ` · ${row.customer_code}` : ''}</small></strong>, defaultWidth: 310 },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase(), defaultWidth: 105 },
    { id: 'fee', header: 'Plan fee', value: (row) => row.monthly_fee ?? '', render: (row) => <strong>{money(row.monthly_fee)}</strong>, defaultWidth: 145 },
    { id: 'payment', header: 'Payment', value: (row) => `${row.payment_status} ${row.payment_reference ?? ''}`, render: (row) => <div><StatusBadge value={row.payment_status} /><small>{row.payment_reference || money(row.payment_amount)}</small></div>, defaultWidth: 180 },
    { id: 'date', header: 'Scheduled date', value: (row) => row.scheduled_date ?? '', render: (row) => <span>{row.scheduled_date ? new Date(`${row.scheduled_date}T12:00:00`).toLocaleDateString('en-ZA') : 'Not scheduled'}</span>, defaultWidth: 155 },
    { id: 'coverage', header: 'Service outcome', value: (row) => `${row.obligation_status} ${row.completion_source ?? ''}`, render: (row) => <div><StatusBadge value={row.obligation_status} /><small>{row.completion_source ? `Matched by ${row.completion_source.replace(/_/g, ' ')}` : 'No completion evidence'}</small></div>, defaultWidth: 205 },
    { id: 'exception', header: 'Paid but not serviced', value: (row) => row.paid_not_serviced ? 'yes' : 'no', render: (row) => <StatusBadge value={row.paid_not_serviced ? 'warning' : 'active'} label={row.paid_not_serviced ? 'Requires action' : 'Covered'} />, defaultWidth: 195 },
    { id: 'reference', header: 'Service evidence', value: (row) => row.completion_reference ?? '', render: (row) => <span>{row.completion_reference || 'No service reference'}</span>, defaultWidth: 260 },
  ], []);

  return (
    <div className="monthly-service-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={() => loadData()} type="button">{loading ? 'Refreshing…' : 'Refresh coverage'}</button>}
        description="Finance confirms monthly-service entitlement and payment. Paid months automatically create Operations service obligations."
        lastUpdated={lastUpdated}
        title="Monthly service control"
      >
        <label>Service month<input type="month" value={serviceMonth.slice(0, 7)} onChange={(event) => setServiceMonth(`${event.target.value}-01`)} /></label>
        <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item} value={item}>{item === 'all' ? 'All branches' : item.toUpperCase()}</option>)}</select></label>
        <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, code or payment reference" /></label>
      </PageToolbar>

      <div className="grid grid-5 monthly-service-kpis">
        <KpiCard label="Active monthly plans" value={metrics.activePlans} helper="Finance-approved monthly-service accounts." />
        <KpiCard label="Paid this month" value={metrics.paid} helper="Payments confirmed for the selected month." />
        <KpiCard label="Serviced" value={metrics.serviced} helper="Completed through ERP jobs or matched service logs." />
        <KpiCard label="Paid not serviced" value={metrics.missed} helper="Finance exceptions requiring Operations action." />
        <KpiCard label="Payment not recorded" value={metrics.unrecorded} helper="Active monthly plans awaiting Finance status." />
      </div>

      <section className="neo-card monthly-service-section">
        <div className="minimal-panel-header">
          <div><span className="minimal-kicker">Finance exception report</span><h2>Paid monthly service coverage</h2><p>Use this table to identify customers who paid but have no completed service evidence.</p></div>
        </div>
        <EnterpriseDataTable
          columns={coverageColumns}
          defaultPageSize={100}
          emptyMessage={loading ? 'Loading monthly coverage…' : 'No active monthly service plans match the selected filters.'}
          rowKey={(row) => row.service_plan_id}
          rows={coverage}
          searchPlaceholder="Search coverage records"
        />
      </section>

      <section className="neo-card monthly-service-section">
        <div className="minimal-panel-header service-plan-heading">
          <div><span className="minimal-kicker">Customer classification</span><h2>Monthly plan and request-only setup</h2><p>Imported 30-day records remain pending until Finance confirms that a monthly service fee is valid.</p></div>
          <label>Plan status<select value={planStatus} onChange={(event) => setPlanStatus(event.target.value)}>{planStatuses.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></label>
        </div>

        <EnterpriseDataTable
          columns={planColumns}
          defaultPageSize={100}
          emptyMessage={loading ? 'Loading customer service plans…' : 'No customer plans match the selected filters.'}
          rowKey={(row) => row.customer_id}
          rows={plans}
          searchPlaceholder="Search customer service plans"
        />

        <div className="monthly-service-editor-grid finance-service-editor">
          <div className="monthly-service-editor-panel">
            <h3>{selectedPlan ? `Service basis: ${selectedPlan.customer_name}` : 'Select a customer to review'}</h3>
            <div className="form-grid">
              <label>Service basis<select disabled={!selectedPlan || saving} value={serviceMode} onChange={(event) => setServiceMode(event.target.value as 'monthly' | 'on_request')}><option value="monthly">Paid monthly service</option><option value="on_request">Service on request only</option></select></label>
              <label>Finance status<select disabled={!selectedPlan || saving} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="pending_finance_review">Pending Finance review</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="ended">Ended</option></select></label>
              <label>Monthly fee<input disabled={!selectedPlan || saving || serviceMode !== 'monthly'} min="0" step="0.01" type="number" value={monthlyFee} onChange={(event) => setMonthlyFee(event.target.value)} /></label>
              <label>Preferred day of month<input disabled={!selectedPlan || saving || serviceMode !== 'monthly'} max="31" min="1" type="number" value={preferredDay} onChange={(event) => setPreferredDay(event.target.value)} /></label>
              <label>Allowed service window (days)<input disabled={!selectedPlan || saving || serviceMode !== 'monthly'} max="21" min="0" type="number" value={windowDays} onChange={(event) => setWindowDays(event.target.value)} /></label>
            </div>
            <label>Finance notes<textarea disabled={!selectedPlan || saving} value={planNotes} onChange={(event) => setPlanNotes(event.target.value)} placeholder="Record the contract, billing source and any exceptions." /></label>
            <button className="button" disabled={!selectedPlan || saving} onClick={savePlan} type="button">{saving ? 'Saving…' : 'Save Finance classification'}</button>
          </div>

          <div className="monthly-service-editor-panel">
            <h3>Record payment for selected month</h3>
            <p>Recording a payment as paid automatically creates the monthly service obligation and checks the historical service logs for completion evidence.</p>
            <div className="form-grid">
              <label>Payment status<select disabled={!selectedPlan?.service_plan_id || saving} value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>{paymentStatuses.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Amount<input disabled={!selectedPlan?.service_plan_id || saving} min="0" step="0.01" type="number" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
              <label>Payment reference<input disabled={!selectedPlan?.service_plan_id || saving} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Invoice, receipt or debit-order reference" /></label>
            </div>
            <label>Payment notes<textarea disabled={!selectedPlan?.service_plan_id || saving} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></label>
            <button className="button secondary" disabled={!selectedPlan?.service_plan_id || saving || selectedPlan.plan_status !== 'active'} onClick={recordPayment} type="button">Record payment and generate schedule</button>
          </div>
        </div>
      </section>
    </div>
  );
}
