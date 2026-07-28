'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { CustomerRecord } from '@/types/enterprise-records';

type Relation<T> = T | T[] | null;
type WorkspaceTab = 'overview' | 'locations' | 'service' | 'commercial' | 'activity';

type SiteRow = {
  id: string;
  site_name: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: string | null;
};

type SiteRelation = {
  site_name: string | null;
  address: string | null;
};

type MachineRelation = {
  machine_name: string | null;
  serial_number: string | null;
};

type MachineRow = {
  id: string;
  site_id: string | null;
  machine_name: string | null;
  model: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  asset_tag: string | null;
  status: string;
  condition: string | null;
  criticality: string | null;
  created_at: string;
  customer_sites?: Relation<SiteRelation>;
};

type ContractRow = {
  id: string;
  contract_number: string | null;
  contract_type: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
};

type ServiceRow = {
  id: string;
  job_number: string;
  incident_number: string;
  machine_id: string | null;
  site_id: string | null;
  summary: string;
  complaint_details: string;
  priority: string;
  status: string;
  due_at: string | null;
  reported_at: string;
  completed_at: string | null;
  closed_at: string | null;
  created_at: string;
  machines?: Relation<MachineRelation>;
  customer_sites?: Relation<SiteRelation>;
};

type DeliveryRow = {
  id: string;
  order_number: string;
  status: string;
  branch: string;
  delivery_address: string | null;
  created_at: string;
  dispatched_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
};

type TimelineEntry = {
  id: string;
  type: 'service' | 'delivery' | 'contract' | 'machine';
  title: string;
  detail: string;
  occurredAt: string;
  href?: string;
  status?: string;
};

type RiskItem = {
  id: string;
  label: string;
  value: number;
  helper: string;
  tone: 'critical' | 'warning' | 'neutral';
  tab: WorkspaceTab;
};

const tabs: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'locations', label: 'Sites & machines' },
  { id: 'service', label: 'Service' },
  { id: 'commercial', label: 'Contracts & deliveries' },
  { id: 'activity', label: 'Activity' },
];

const terminalJobStatuses = new Set(['completed', 'verified', 'closed', 'cancelled']);
const terminalDeliveryStatuses = new Set(['closed', 'cancelled']);

function firstRelation<T>(value: Relation<T> | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function validDate(value: string | null | undefined): value is string {
  return Boolean(value && !Number.isNaN(new Date(value).getTime()));
}

function machineLabel(machine: MachineRow) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? machine.machine_barcode ?? machine.asset_tag ?? 'Unnamed machine';
}

function daysUntil(value: string | null) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

export function Customer360Workspace() {
  const { customerId } = useParams<{ customerId: string }>();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [jobs, setJobs] = useState<ServiceRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const customerResult = await client
      .from('customers')
      .select('id, customer_name, customer_code, branch, phone, email, address, status')
      .eq('id', customerId)
      .single();

    if (customerResult.error) {
      setCustomer(null);
      setError(customerResult.error.message);
      setLoading(false);
      return;
    }

    const customerData = customerResult.data as CustomerRecord;
    setCustomer(customerData);

    const [siteResult, machineResult, contractResult, jobResult, deliveryResult] = await Promise.all([
      client
        .from('customer_sites')
        .select('id, site_name, address, contact_name, contact_phone, status')
        .eq('customer_id', customerId)
        .order('site_name')
        .limit(100),
      client
        .from('machines')
        .select('id, site_id, machine_name, model, serial_number, machine_barcode, asset_tag, status, condition, criticality, created_at, customer_sites(site_name, address)')
        .eq('customer_id', customerId)
        .order('machine_name')
        .limit(200),
      client
        .from('contracts')
        .select('id, contract_number, contract_type, start_date, end_date, status')
        .eq('customer_id', customerId)
        .order('end_date')
        .limit(100),
      client
        .from('service_jobs')
        .select('id, job_number, incident_number, machine_id, site_id, summary, complaint_details, priority, status, due_at, reported_at, completed_at, closed_at, created_at, machines(machine_name, serial_number), customer_sites(site_name, address)')
        .eq('customer_id', customerId)
        .order('reported_at', { ascending: false })
        .limit(200),
      client
        .from('delivery_orders')
        .select('id, order_number, status, branch, delivery_address, created_at, dispatched_at, delivered_at, closed_at')
        .eq('customer_name', customerData.customer_name)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const firstError = siteResult.error ?? machineResult.error ?? contractResult.error ?? jobResult.error ?? deliveryResult.error;
    if (firstError) setError(`Some customer information could not be loaded: ${firstError.message}`);

    setSites((siteResult.data ?? []) as SiteRow[]);
    setMachines((machineResult.data ?? []) as MachineRow[]);
    setContracts((contractResult.data ?? []) as ContractRow[]);
    setJobs((jobResult.data ?? []) as ServiceRow[]);
    setDeliveries((deliveryResult.data ?? []) as DeliveryRow[]);
    setLastUpdated(new Date());
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const ninetyDays = now + 90 * 86_400_000;
    const openJobs = jobs.filter((job) => !terminalJobStatuses.has(job.status));
    const overdueJobs = openJobs.filter((job) => job.due_at && new Date(job.due_at).getTime() < now);
    const urgentJobs = openJobs.filter((job) => ['high', 'critical'].includes(job.priority));
    const activeContracts = contracts.filter((contract) => {
      if (contract.status === 'active') return true;
      return Boolean(contract.end_date && new Date(contract.end_date).getTime() >= now);
    });
    const expiringContracts = contracts.filter((contract) => {
      if (!contract.end_date) return false;
      const expiry = new Date(contract.end_date).getTime();
      return expiry >= now && expiry <= ninetyDays;
    });
    const expiredContracts = contracts.filter((contract) => contract.end_date && new Date(contract.end_date).getTime() < now && contract.status !== 'cancelled');
    const atRiskMachines = machines.filter((machine) => ['poor', 'critical'].includes(machine.condition ?? '') || ['repair', 'inactive'].includes(machine.status));
    const unlinkedMachines = machines.filter((machine) => !machine.site_id);
    const openDeliveries = deliveries.filter((delivery) => !terminalDeliveryStatuses.has(delivery.status));

    return {
      openJobs,
      overdueJobs,
      urgentJobs,
      activeContracts,
      expiringContracts,
      expiredContracts,
      atRiskMachines,
      unlinkedMachines,
      openDeliveries,
      activeMachines: machines.filter((machine) => machine.status === 'active').length,
    };
  }, [contracts, deliveries, jobs, machines]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];

    jobs.forEach((job) => {
      const detail = job.complaint_details || job.summary;
      if (validDate(job.reported_at || job.created_at)) {
        entries.push({
          id: `service-reported-${job.id}`,
          type: 'service',
          title: `${job.job_number} reported`,
          detail,
          occurredAt: job.reported_at || job.created_at,
          href: `/operations/service-jobs?job=${job.id}`,
          status: job.priority,
        });
      }
      if (validDate(job.completed_at)) {
        entries.push({
          id: `service-completed-${job.id}`,
          type: 'service',
          title: `${job.job_number} completed`,
          detail: job.summary,
          occurredAt: job.completed_at,
          href: `/operations/service-jobs?job=${job.id}`,
          status: 'completed',
        });
      }
      if (validDate(job.closed_at)) {
        entries.push({
          id: `service-closed-${job.id}`,
          type: 'service',
          title: `${job.job_number} closed`,
          detail: job.summary,
          occurredAt: job.closed_at,
          href: `/operations/service-jobs?job=${job.id}`,
          status: 'closed',
        });
      }
    });

    deliveries.forEach((delivery) => {
      const detail = delivery.delivery_address ?? `${delivery.branch.toUpperCase()} delivery`;
      entries.push({
        id: `delivery-created-${delivery.id}`,
        type: 'delivery',
        title: `${delivery.order_number} created`,
        detail,
        occurredAt: delivery.created_at,
        href: `/operations/deliveries?order=${delivery.id}`,
        status: delivery.status,
      });
      if (validDate(delivery.dispatched_at)) {
        entries.push({ id: `delivery-dispatched-${delivery.id}`, type: 'delivery', title: `${delivery.order_number} dispatched`, detail, occurredAt: delivery.dispatched_at, href: `/operations/deliveries?order=${delivery.id}`, status: 'dispatched' });
      }
      if (validDate(delivery.delivered_at)) {
        entries.push({ id: `delivery-delivered-${delivery.id}`, type: 'delivery', title: `${delivery.order_number} delivered`, detail, occurredAt: delivery.delivered_at, href: `/operations/deliveries?order=${delivery.id}`, status: 'delivered' });
      }
      if (validDate(delivery.closed_at)) {
        entries.push({ id: `delivery-closed-${delivery.id}`, type: 'delivery', title: `${delivery.order_number} closed`, detail, occurredAt: delivery.closed_at, href: `/operations/deliveries?order=${delivery.id}`, status: 'closed' });
      }
    });

    contracts.forEach((contract) => {
      if (validDate(contract.start_date)) {
        entries.push({
          id: `contract-start-${contract.id}`,
          type: 'contract',
          title: `${contract.contract_number ?? 'Contract'} started`,
          detail: contract.contract_type ?? 'Customer contract',
          occurredAt: contract.start_date,
          status: contract.status ?? 'unknown',
        });
      }
      if (validDate(contract.end_date)) {
        entries.push({
          id: `contract-end-${contract.id}`,
          type: 'contract',
          title: `${contract.contract_number ?? 'Contract'} end date`,
          detail: contract.contract_type ?? 'Customer contract',
          occurredAt: contract.end_date,
          status: contract.status ?? 'unknown',
        });
      }
    });

    machines.forEach((machine) => {
      if (!validDate(machine.created_at)) return;
      entries.push({
        id: `machine-created-${machine.id}`,
        type: 'machine',
        title: `${machineLabel(machine)} added`,
        detail: [machine.model, machine.serial_number].filter(Boolean).join(' · ') || 'Machine master record',
        occurredAt: machine.created_at,
        href: `/operations/assets/${machine.id}`,
        status: machine.status,
      });
    });

    return entries
      .filter((entry) => validDate(entry.occurredAt))
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      .slice(0, 80);
  }, [contracts, deliveries, jobs, machines]);

  const risks = useMemo<RiskItem[]>(() => [
    { id: 'overdue-jobs', label: 'Overdue service', value: metrics.overdueJobs.length, helper: 'Active jobs beyond their due time.', tone: metrics.overdueJobs.length ? 'critical' : 'neutral', tab: 'service' },
    { id: 'urgent-jobs', label: 'Urgent service', value: metrics.urgentJobs.length, helper: 'High or critical open jobs.', tone: metrics.urgentJobs.length ? 'warning' : 'neutral', tab: 'service' },
    { id: 'machine-risk', label: 'Machine risk', value: metrics.atRiskMachines.length, helper: 'Repair, inactive, poor or critical assets.', tone: metrics.atRiskMachines.length ? 'warning' : 'neutral', tab: 'locations' },
    { id: 'contract-risk', label: 'Contract follow-up', value: metrics.expiringContracts.length + metrics.expiredContracts.length, helper: 'Expired or expiring within 90 days.', tone: metrics.expiredContracts.length ? 'critical' : metrics.expiringContracts.length ? 'warning' : 'neutral', tab: 'commercial' },
  ], [metrics]);

  if (loading && !customer) {
    return (
      <div aria-busy="true" className="customer360-loading" role="status">
        <div className="customer360-loading-hero" />
        <div className="customer360-loading-grid">
          {Array.from({ length: 6 }, (_, index) => <div className="customer360-loading-card" key={index} />)}
        </div>
        <span>Loading customer workspace…</span>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="neo-card customer360-not-found">
        <span className="minimal-kicker">Customer master</span>
        <h1>Customer not found</h1>
        <p>{error ?? 'This customer record is unavailable or outside your access scope.'}</p>
        <Link className="button" href="/customers">Back to customer directory</Link>
      </div>
    );
  }

  const contactActions = [
    customer.phone ? { href: `tel:${customer.phone}`, label: 'Call customer' } : null,
    customer.email ? { href: `mailto:${customer.email}`, label: 'Email customer' } : null,
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  return (
    <div className="customer360-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}

      <section className="customer360-hero">
        <div className="customer360-hero-copy">
          <div className="customer360-eyebrow-row">
            <span className="minimal-kicker">Customer 360</span>
            <StatusBadge value={customer.status ?? 'unknown'} />
          </div>
          <h1>{customer.customer_name}</h1>
          <p className="customer360-identity">{customer.customer_code ?? 'No account code'} · {customer.branch.toUpperCase()}</p>
          <p className="customer360-address">{customer.address ?? 'No primary address has been captured.'}</p>
          <div className="customer360-contact-actions">
            {contactActions.map((action) => <a className="button secondary" href={action.href} key={action.href}>{action.label}</a>)}
            <Link className="button secondary" href="/customers">Back to directory</Link>
          </div>
        </div>
        <div className="customer360-hero-summary">
          <span>Operational relationship</span>
          <strong>{sites.length} site{sites.length === 1 ? '' : 's'} · {machines.length} machine{machines.length === 1 ? '' : 's'}</strong>
          <small>{metrics.openJobs.length} open service job{metrics.openJobs.length === 1 ? '' : 's'} · {metrics.openDeliveries.length} open deliver{metrics.openDeliveries.length === 1 ? 'y' : 'ies'}</small>
        </div>
      </section>

      <PageToolbar
        actions={(
          <>
            <Link className="button" href="/operations/service-jobs">Create service call</Link>
            <button className="button secondary" disabled={loading} onClick={() => void loadProfile()} type="button">{loading ? 'Refreshing…' : 'Refresh customer'}</button>
          </>
        )}
        description="Customer, site, machine, service, contract and delivery context in one operational workspace."
        lastUpdated={lastUpdated}
        title="Customer workspace"
      />

      <section aria-label="Customer metrics" className="customer360-metrics">
        <button onClick={() => setActiveTab('locations')} type="button"><span>Sites</span><strong>{sites.length}</strong><small>Customer operating locations</small></button>
        <button onClick={() => setActiveTab('locations')} type="button"><span>Active machines</span><strong>{metrics.activeMachines}</strong><small>{machines.length} machine records total</small></button>
        <button onClick={() => setActiveTab('service')} type="button"><span>Open service</span><strong>{metrics.openJobs.length}</strong><small>{metrics.overdueJobs.length} overdue</small></button>
        <button onClick={() => setActiveTab('commercial')} type="button"><span>Active contracts</span><strong>{metrics.activeContracts.length}</strong><small>{metrics.expiringContracts.length} expiring soon</small></button>
        <button onClick={() => setActiveTab('commercial')} type="button"><span>Open deliveries</span><strong>{metrics.openDeliveries.length}</strong><small>{deliveries.length} delivery records</small></button>
        <button onClick={() => setActiveTab('activity')} type="button"><span>Activity events</span><strong>{timeline.length}</strong><small>Most recent linked events</small></button>
      </section>

      <nav aria-label="Customer workspace sections" className="customer360-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            aria-controls={`customer360-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'is-active' : ''}
            id={`customer360-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' ? (
        <section aria-labelledby="customer360-tab-overview" className="customer360-panel" id="customer360-panel-overview" role="tabpanel">
          <div className="customer360-overview-grid">
            <article className="neo-card customer360-contact-card">
              <div className="customer360-section-heading">
                <div><span className="minimal-kicker">Master data</span><h2>Primary contact</h2></div>
                <StatusBadge value={customer.status ?? 'unknown'} />
              </div>
              <dl className="customer360-details-list">
                <div><dt>Account code</dt><dd>{customer.customer_code ?? 'Not recorded'}</dd></div>
                <div><dt>Branch</dt><dd>{customer.branch.toUpperCase()}</dd></div>
                <div><dt>Telephone</dt><dd>{customer.phone ?? 'Not recorded'}</dd></div>
                <div><dt>Email</dt><dd>{customer.email ?? 'Not recorded'}</dd></div>
                <div><dt>Address</dt><dd>{customer.address ?? 'Not recorded'}</dd></div>
              </dl>
            </article>

            <article className="neo-card customer360-risk-card">
              <div className="customer360-section-heading"><div><span className="minimal-kicker">Attention</span><h2>Relationship risk</h2></div></div>
              <div className="customer360-risk-grid">
                {risks.map((risk) => (
                  <button className={`customer360-risk-item tone-${risk.tone}`} key={risk.id} onClick={() => setActiveTab(risk.tab)} type="button">
                    <span>{risk.label}</span><strong>{risk.value}</strong><small>{risk.helper}</small>
                  </button>
                ))}
              </div>
            </article>
          </div>

          <article className="neo-card customer360-recent-activity">
            <div className="customer360-section-heading">
              <div><span className="minimal-kicker">Recent history</span><h2>Latest customer activity</h2></div>
              <button className="button secondary compact-action" onClick={() => setActiveTab('activity')} type="button">View full timeline</button>
            </div>
            <TimelineList entries={timeline.slice(0, 10)} />
          </article>
        </section>
      ) : null}

      {activeTab === 'locations' ? (
        <section aria-labelledby="customer360-tab-locations" className="customer360-panel" id="customer360-panel-locations" role="tabpanel">
          <article className="neo-card">
            <div className="customer360-section-heading"><div><span className="minimal-kicker">Customer footprint</span><h2>Sites</h2><p>Addresses and local contact details linked to this account.</p></div><strong>{sites.length}</strong></div>
            <div className="customer360-card-grid">
              {sites.length === 0 ? <div className="empty-state">No customer sites are linked.</div> : sites.map((site) => (
                <article className="customer360-record-card" key={site.id}>
                  <div className="customer360-record-heading"><strong>{site.site_name}</strong><StatusBadge value={site.status ?? 'active'} /></div>
                  <p>{site.address ?? 'No address captured'}</p>
                  <dl><div><dt>Contact</dt><dd>{site.contact_name ?? 'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{site.contact_phone ?? 'Not recorded'}</dd></div></dl>
                </article>
              ))}
            </div>
          </article>

          <article className="neo-card">
            <div className="customer360-section-heading"><div><span className="minimal-kicker">Installed base</span><h2>Machines</h2><p>Open an asset to review lifecycle, custody, audits and full service history.</p></div><strong>{machines.length}</strong></div>
            <div className="customer360-card-grid">
              {machines.length === 0 ? <div className="empty-state">No machines are linked.</div> : machines.map((machine) => {
                const site = firstRelation(machine.customer_sites);
                return (
                  <Link className="customer360-record-card customer360-linked-card" href={`/operations/assets/${machine.id}`} key={machine.id}>
                    <div className="customer360-record-heading"><strong>{machineLabel(machine)}</strong><StatusBadge value={machine.status} /></div>
                    <p>{machine.model ?? 'Model not recorded'} · {machine.serial_number ?? machine.machine_barcode ?? machine.asset_tag ?? 'No machine identifier'}</p>
                    <dl>
                      <div><dt>Site</dt><dd>{site?.site_name ?? 'Not linked'}</dd></div>
                      <div><dt>Condition</dt><dd>{machine.condition ?? 'unknown'}</dd></div>
                      <div><dt>Criticality</dt><dd>{machine.criticality ?? 'not set'}</dd></div>
                    </dl>
                  </Link>
                );
              })}
            </div>
            {metrics.unlinkedMachines.length ? <div className="customer360-inline-warning">{metrics.unlinkedMachines.length} machine record{metrics.unlinkedMachines.length === 1 ? ' is' : 's are'} not linked to a customer site.</div> : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'service' ? (
        <section aria-labelledby="customer360-tab-service" className="customer360-panel" id="customer360-panel-service" role="tabpanel">
          <article className="neo-card">
            <div className="customer360-section-heading">
              <div><span className="minimal-kicker">Service relationship</span><h2>Service jobs</h2><p>Open work appears first, followed by completed and closed history.</p></div>
              <Link className="button" href="/operations/service-jobs">Open scheduled call log</Link>
            </div>
            <div className="customer360-service-list">
              {jobs.length === 0 ? <div className="empty-state">No service jobs are linked.</div> : [...jobs].sort((left, right) => {
                const leftOpen = terminalJobStatuses.has(left.status) ? 1 : 0;
                const rightOpen = terminalJobStatuses.has(right.status) ? 1 : 0;
                if (leftOpen !== rightOpen) return leftOpen - rightOpen;
                return new Date(right.reported_at).getTime() - new Date(left.reported_at).getTime();
              }).map((job) => {
                const machine = firstRelation(job.machines);
                const site = firstRelation(job.customer_sites);
                const overdue = Boolean(job.due_at && new Date(job.due_at).getTime() < Date.now() && !terminalJobStatuses.has(job.status));
                return (
                  <Link className={`customer360-service-row ${overdue ? 'is-overdue' : ''}`} href={`/operations/service-jobs?job=${job.id}`} key={job.id}>
                    <div className="customer360-service-main"><span>{job.job_number} · Incident {job.incident_number}</span><strong>{job.complaint_details || job.summary}</strong><small>{site?.site_name ?? 'Site not linked'} · {machine?.machine_name ?? machine?.serial_number ?? 'Machine not linked'}</small></div>
                    <div className="customer360-service-meta"><StatusBadge value={job.priority} /><StatusBadge value={overdue ? 'overdue' : job.status} /><small>{job.due_at ? `Due ${formatDateTime(job.due_at)}` : `Reported ${formatDateTime(job.reported_at)}`}</small></div>
                  </Link>
                );
              })}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'commercial' ? (
        <section aria-labelledby="customer360-tab-commercial" className="customer360-panel" id="customer360-panel-commercial" role="tabpanel">
          <div className="customer360-commercial-grid">
            <article className="neo-card">
              <div className="customer360-section-heading"><div><span className="minimal-kicker">Commercial coverage</span><h2>Contracts</h2></div><strong>{contracts.length}</strong></div>
              <div className="customer360-stack-list">
                {contracts.length === 0 ? <div className="empty-state">No contracts are linked.</div> : contracts.map((contract) => {
                  const remaining = daysUntil(contract.end_date);
                  return (
                    <article className="customer360-contract-row" key={contract.id}>
                      <div><strong>{contract.contract_number ?? 'Contract'}</strong><span>{contract.contract_type ?? 'Type not recorded'}</span></div>
                      <div><StatusBadge value={contract.status ?? 'unknown'} /><small>{formatDate(contract.start_date)} — {formatDate(contract.end_date)}</small>{remaining !== null && remaining >= 0 && remaining <= 90 ? <em>{remaining} days remaining</em> : null}{remaining !== null && remaining < 0 ? <em className="is-critical">Expired {Math.abs(remaining)} days ago</em> : null}</div>
                    </article>
                  );
                })}
              </div>
            </article>

            <article className="neo-card">
              <div className="customer360-section-heading"><div><span className="minimal-kicker">Logistics history</span><h2>Deliveries</h2></div><Link className="button secondary compact-action" href="/operations/deliveries">Open board</Link></div>
              <div className="customer360-stack-list">
                {deliveries.length === 0 ? <div className="empty-state">No delivery orders were found.</div> : deliveries.map((delivery) => (
                  <Link className="customer360-delivery-row" href={`/operations/deliveries?order=${delivery.id}`} key={delivery.id}>
                    <div><strong>{delivery.order_number}</strong><span>{delivery.delivery_address ?? 'No delivery address'}</span></div>
                    <div><StatusBadge value={delivery.status} /><small>{delivery.branch.toUpperCase()} · {formatDateTime(delivery.created_at)}</small></div>
                  </Link>
                ))}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === 'activity' ? (
        <section aria-labelledby="customer360-tab-activity" className="customer360-panel" id="customer360-panel-activity" role="tabpanel">
          <article className="neo-card">
            <div className="customer360-section-heading"><div><span className="minimal-kicker">Relationship history</span><h2>Unified activity timeline</h2><p>Service, delivery, contract and machine events ordered by date.</p></div><strong>{timeline.length}</strong></div>
            <TimelineList entries={timeline} />
          </article>
        </section>
      ) : null}
    </div>
  );
}

function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <div className="empty-state">No linked activity is available.</div>;

  return (
    <div className="customer360-timeline">
      {entries.map((entry) => {
        const content = (
          <>
            <span className={`customer360-timeline-marker type-${entry.type}`} />
            <div className="customer360-timeline-copy"><strong>{entry.title}</strong><p>{entry.detail}</p><small>{formatDateTime(entry.occurredAt)}</small></div>
            {entry.status ? <StatusBadge value={entry.status} /> : null}
          </>
        );
        return entry.href ? <Link className="customer360-timeline-entry" href={entry.href} key={entry.id}>{content}</Link> : <article className="customer360-timeline-entry" key={entry.id}>{content}</article>;
      })}
    </div>
  );
}
