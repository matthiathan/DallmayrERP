'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { CustomerRecord } from '@/types/enterprise-records';

type ItemCardTab = 'overview' | 'updates' | 'related' | 'files';

type SiteRow = {
  id: string;
  site_name: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: string | null;
};

type MachineRow = {
  id: string;
  machine_name: string | null;
  model: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  status: string;
  condition: string | null;
  created_at: string;
};

type JobRow = {
  id: string;
  job_number: string;
  summary: string;
  complaint_details: string;
  priority: string;
  status: string;
  due_at: string | null;
  reported_at: string;
  completed_at: string | null;
};

type ContractRow = {
  id: string;
  contract_number: string | null;
  contract_type: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
};

type DeliveryRow = {
  id: string;
  order_number: string;
  status: string;
  branch: string;
  delivery_address: string | null;
  created_at: string;
  delivered_at: string | null;
};

type ClosureRow = {
  id: string;
  outcome: string;
  notes: string | null;
  photo_bucket: string | null;
  photo_path: string | null;
  machine_barcode: string;
  site_address: string | null;
  closed_at: string;
};

type ActivityEntry = {
  id: string;
  title: string;
  detail: string;
  occurredAt: string;
  tone: string;
  href?: string;
};

const TERMINAL_JOB_STATUSES = new Set(['completed', 'verified', 'closed', 'cancelled']);
const TERMINAL_DELIVERY_STATUSES = new Set(['closed', 'cancelled']);
const tabs: Array<{ id: ItemCardTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'updates', label: 'Updates' },
  { id: 'related', label: 'Related' },
  { id: 'files', label: 'Files' },
];

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(date);
}

function machineLabel(machine: MachineRow) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine';
}

function fileName(path: string) {
  const candidate = path.split('/').pop();
  return candidate || 'Service evidence';
}

export function CustomerItemCard({
  customerId,
  initialCustomer,
  open,
  onClose,
}: {
  customerId: string | null;
  initialCustomer: CustomerRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState<CustomerRecord | null>(initialCustomer);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [activeTab, setActiveTab] = useState<ItemCardTab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusHandle = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusHandle);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;

    async function loadCustomerCard() {
      setLoading(true);
      setError(null);
      setActiveTab('overview');
      setCustomer(initialCustomer?.id === customerId ? initialCustomer : null);
      const client = getSupabaseClient();

      let baseCustomer = initialCustomer?.id === customerId ? initialCustomer : null;
      if (!baseCustomer) {
        const customerResult = await client
          .from('customers')
          .select('id, customer_name, customer_code, branch, phone, email, address, status')
          .eq('id', customerId)
          .single();
        if (cancelled) return;
        if (customerResult.error) {
          setCustomer(null);
          setError(customerResult.error.message);
          setLoading(false);
          return;
        }
        baseCustomer = customerResult.data as CustomerRecord;
      }
      setCustomer(baseCustomer);

      const [siteResult, machineResult, jobResult, contractResult, deliveryResult, closureResult] = await Promise.all([
        client
          .from('customer_sites')
          .select('id, site_name, address, contact_name, contact_phone, status')
          .eq('customer_id', customerId)
          .order('site_name')
          .limit(25),
        client
          .from('machines')
          .select('id, machine_name, model, serial_number, machine_barcode, status, condition, created_at')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(25),
        client
          .from('service_jobs')
          .select('id, job_number, summary, complaint_details, priority, status, due_at, reported_at, completed_at')
          .eq('customer_id', customerId)
          .order('reported_at', { ascending: false })
          .limit(40),
        client
          .from('contracts')
          .select('id, contract_number, contract_type, start_date, end_date, status')
          .eq('customer_id', customerId)
          .order('end_date', { ascending: true })
          .limit(25),
        client
          .from('delivery_orders')
          .select('id, order_number, status, branch, delivery_address, created_at, delivered_at')
          .eq('customer_name', baseCustomer.customer_name)
          .order('created_at', { ascending: false })
          .limit(30),
        client
          .from('task_closures')
          .select('id, outcome, notes, photo_bucket, photo_path, machine_barcode, site_address, closed_at')
          .eq('customer_name', baseCustomer.customer_name)
          .order('closed_at', { ascending: false })
          .limit(30),
      ]);

      if (cancelled) return;
      setSites((siteResult.data ?? []) as SiteRow[]);
      setMachines((machineResult.data ?? []) as MachineRow[]);
      setJobs((jobResult.data ?? []) as JobRow[]);
      setContracts((contractResult.data ?? []) as ContractRow[]);
      setDeliveries((deliveryResult.data ?? []) as DeliveryRow[]);
      setClosures((closureResult.data ?? []) as ClosureRow[]);

      const firstPartialError = siteResult.error ?? machineResult.error ?? jobResult.error ?? contractResult.error ?? deliveryResult.error ?? closureResult.error;
      if (firstPartialError) setError(`Some related information could not be loaded: ${firstPartialError.message}`);
      setLastUpdated(new Date());
      setLoading(false);
    }

    void loadCustomerCard();
    return () => {
      cancelled = true;
    };
  }, [customerId, initialCustomer, open]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const openJobs = jobs.filter((job) => !TERMINAL_JOB_STATUSES.has(job.status));
    return {
      openJobs,
      overdueJobs: openJobs.filter((job) => Boolean(job.due_at && new Date(job.due_at).getTime() < now)),
      urgentJobs: openJobs.filter((job) => ['high', 'critical'].includes(job.priority)),
      activeMachines: machines.filter((machine) => machine.status === 'active').length,
      openDeliveries: deliveries.filter((delivery) => !TERMINAL_DELIVERY_STATUSES.has(delivery.status)),
      activeContracts: contracts.filter((contract) => contract.status === 'active' || Boolean(contract.end_date && new Date(contract.end_date).getTime() >= now)),
    };
  }, [contracts, deliveries, jobs, machines]);

  const activity = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];
    jobs.forEach((job) => {
      entries.push({
        id: `job-reported-${job.id}`,
        title: `${job.job_number} reported`,
        detail: job.complaint_details || job.summary,
        occurredAt: job.reported_at,
        tone: job.priority,
        href: `/operations/service-jobs?job=${job.id}`,
      });
      if (job.completed_at) entries.push({ id: `job-completed-${job.id}`, title: `${job.job_number} completed`, detail: job.summary, occurredAt: job.completed_at, tone: 'completed', href: `/operations/service-jobs?job=${job.id}` });
    });
    deliveries.forEach((delivery) => {
      entries.push({ id: `delivery-created-${delivery.id}`, title: `${delivery.order_number} created`, detail: delivery.delivery_address ?? `${delivery.branch.toUpperCase()} delivery`, occurredAt: delivery.created_at, tone: delivery.status, href: `/operations/deliveries?order=${delivery.id}` });
      if (delivery.delivered_at) entries.push({ id: `delivery-delivered-${delivery.id}`, title: `${delivery.order_number} delivered`, detail: delivery.delivery_address ?? 'Delivery completed', occurredAt: delivery.delivered_at, tone: 'delivered', href: `/operations/deliveries?order=${delivery.id}` });
    });
    closures.forEach((closure) => entries.push({ id: `closure-${closure.id}`, title: 'Field work update', detail: closure.notes || closure.outcome.replace(/_/g, ' '), occurredAt: closure.closed_at, tone: closure.outcome }));
    machines.forEach((machine) => entries.push({ id: `machine-${machine.id}`, title: `${machineLabel(machine)} added`, detail: [machine.model, machine.serial_number].filter(Boolean).join(' · ') || 'Machine record', occurredAt: machine.created_at, tone: machine.status, href: `/operations/assets/${machine.id}` }));
    return entries
      .filter((entry) => !Number.isNaN(new Date(entry.occurredAt).getTime()))
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      .slice(0, 40);
  }, [closures, deliveries, jobs, machines]);

  const evidenceFiles = useMemo(() => closures.filter((closure) => Boolean(closure.photo_path)), [closures]);

  async function openEvidence(closure: ClosureRow) {
    if (!closure.photo_path) return;
    const bucket = closure.photo_bucket || 'dallmayrerp-task-photos';
    const { data, error: signedUrlError } = await getSupabaseClient().storage.from(bucket).createSignedUrl(closure.photo_path, 60);
    if (signedUrlError) {
      setError(signedUrlError.message);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  if (!open || !customerId) return null;

  return (
    <div className="monday-item-card-layer" data-open="true">
      <button aria-label="Close customer item card" className="monday-item-card-backdrop" onClick={onClose} type="button" />
      <aside
        aria-label={customer ? `${customer.customer_name} customer item card` : 'Customer item card'}
        aria-modal="true"
        className="monday-item-card"
        ref={panelRef}
        role="dialog"
      >
        <header className="monday-item-card-header">
          <div className="monday-item-card-identity">
            <span>Customer item</span>
            <div><h2>{customer?.customer_name ?? 'Loading customer…'}</h2>{customer ? <StatusBadge value={customer.status ?? 'unknown'} /> : null}</div>
            <p>{customer ? `${customer.customer_code || 'No account code'} · ${customer.branch.toUpperCase()}` : 'Loading authorised customer information.'}</p>
          </div>
          <button aria-label="Close customer item card" className="monday-item-card-close" onClick={onClose} ref={closeButtonRef} type="button">×</button>
        </header>

        {customer ? (
          <div className="monday-item-card-actions">
            <Link className="button" href={`/customers/${customer.id}`}>Open full profile</Link>
            {customer.phone ? <a className="button secondary" href={`tel:${customer.phone}`}>Call</a> : null}
            {customer.email ? <a className="button secondary" href={`mailto:${customer.email}`}>Email</a> : null}
          </div>
        ) : null}

        <nav aria-label="Customer item card sections" className="monday-item-card-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'is-active' : undefined}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}{tab.id === 'files' && evidenceFiles.length > 0 ? <span>{evidenceFiles.length}</span> : null}
            </button>
          ))}
        </nav>

        <div className="monday-item-card-body">
          {error ? <div className="error" role="alert">{error}</div> : null}
          {loading && !customer ? <div className="monday-item-card-loading" role="status">Loading customer item…</div> : null}
          {!loading && !customer ? <div className="empty-state">This customer is unavailable or outside your access scope.</div> : null}

          {customer && activeTab === 'overview' ? (
            <div className="monday-item-card-stack" role="tabpanel">
              <section className="monday-item-card-metrics" aria-label="Customer summary">
                <button onClick={() => setActiveTab('related')} type="button"><span>Sites</span><strong>{sites.length}</strong></button>
                <button onClick={() => setActiveTab('related')} type="button"><span>Machines</span><strong>{machines.length}</strong><small>{metrics.activeMachines} active</small></button>
                <button onClick={() => setActiveTab('related')} type="button"><span>Open service</span><strong>{metrics.openJobs.length}</strong><small>{metrics.overdueJobs.length} overdue</small></button>
                <button onClick={() => setActiveTab('related')} type="button"><span>Contracts</span><strong>{metrics.activeContracts.length}</strong><small>active coverage</small></button>
              </section>

              <section className="monday-item-card-section">
                <header><div><span>Account</span><h3>Customer details</h3></div></header>
                <dl className="monday-item-card-details">
                  <div><dt>Account code</dt><dd>{customer.customer_code || 'Not recorded'}</dd></div>
                  <div><dt>Branch</dt><dd>{customer.branch.toUpperCase()}</dd></div>
                  <div><dt>Phone</dt><dd>{customer.phone || 'Not recorded'}</dd></div>
                  <div><dt>Email</dt><dd>{customer.email || 'Not recorded'}</dd></div>
                  <div className="is-wide"><dt>Address</dt><dd>{customer.address || 'Not recorded'}</dd></div>
                </dl>
              </section>

              <section className="monday-item-card-section">
                <header><div><span>Attention</span><h3>Operational health</h3></div></header>
                <div className="monday-item-card-health-list">
                  <button className={metrics.overdueJobs.length ? 'is-critical' : undefined} onClick={() => setActiveTab('related')} type="button"><span>Overdue service jobs</span><strong>{metrics.overdueJobs.length}</strong></button>
                  <button className={metrics.urgentJobs.length ? 'is-warning' : undefined} onClick={() => setActiveTab('related')} type="button"><span>High-priority service jobs</span><strong>{metrics.urgentJobs.length}</strong></button>
                  <button onClick={() => setActiveTab('related')} type="button"><span>Open deliveries</span><strong>{metrics.openDeliveries.length}</strong></button>
                </div>
              </section>

              <section className="monday-item-card-section">
                <header><div><span>Latest</span><h3>Recent updates</h3></div><button className="monday-item-card-text-button" onClick={() => setActiveTab('updates')} type="button">View all</button></header>
                <ActivityList entries={activity.slice(0, 5)} />
              </section>
            </div>
          ) : null}

          {customer && activeTab === 'updates' ? (
            <section className="monday-item-card-section monday-item-card-section-fill" role="tabpanel">
              <header><div><span>Activity</span><h3>Customer updates</h3><p>Service, delivery, machine and field-work events in time order.</p></div></header>
              <ActivityList entries={activity} />
            </section>
          ) : null}

          {customer && activeTab === 'related' ? (
            <div className="monday-item-card-stack" role="tabpanel">
              <RelatedSection count={sites.length} title="Sites">
                {sites.length === 0 ? <div className="empty-state">No linked sites.</div> : sites.slice(0, 8).map((site) => <article className="monday-item-card-related-row" key={site.id}><div><strong>{site.site_name}</strong><span>{site.address || 'No address'}</span></div><StatusBadge value={site.status ?? 'active'} /></article>)}
              </RelatedSection>
              <RelatedSection count={machines.length} title="Machines">
                {machines.length === 0 ? <div className="empty-state">No linked machines.</div> : machines.slice(0, 8).map((machine) => <Link className="monday-item-card-related-row" href={`/operations/assets/${machine.id}`} key={machine.id}><div><strong>{machineLabel(machine)}</strong><span>{machine.model || machine.serial_number || machine.machine_barcode || 'No identifier'}</span></div><StatusBadge value={machine.status} /></Link>)}
              </RelatedSection>
              <RelatedSection count={jobs.length} title="Service jobs">
                {jobs.length === 0 ? <div className="empty-state">No linked service jobs.</div> : jobs.slice(0, 10).map((job) => <Link className="monday-item-card-related-row" href={`/operations/service-jobs?job=${job.id}`} key={job.id}><div><strong>{job.job_number}</strong><span>{job.complaint_details || job.summary}</span><small>{job.due_at ? `Due ${formatDateTime(job.due_at)}` : `Reported ${formatDateTime(job.reported_at)}`}</small></div><div className="monday-item-card-related-status"><StatusBadge value={job.priority} /><StatusBadge value={job.status} /></div></Link>)}
              </RelatedSection>
              <RelatedSection count={contracts.length} title="Contracts">
                {contracts.length === 0 ? <div className="empty-state">No linked contracts.</div> : contracts.slice(0, 8).map((contract) => <article className="monday-item-card-related-row" key={contract.id}><div><strong>{contract.contract_number || 'Contract'}</strong><span>{contract.contract_type || 'Type not recorded'}</span><small>{formatDate(contract.start_date)} – {formatDate(contract.end_date)}</small></div><StatusBadge value={contract.status ?? 'unknown'} /></article>)}
              </RelatedSection>
              <RelatedSection count={deliveries.length} title="Deliveries">
                {deliveries.length === 0 ? <div className="empty-state">No linked deliveries.</div> : deliveries.slice(0, 8).map((delivery) => <Link className="monday-item-card-related-row" href={`/operations/deliveries?order=${delivery.id}`} key={delivery.id}><div><strong>{delivery.order_number}</strong><span>{delivery.delivery_address || 'No delivery address'}</span><small>{formatDateTime(delivery.created_at)}</small></div><StatusBadge value={delivery.status} /></Link>)}
              </RelatedSection>
            </div>
          ) : null}

          {customer && activeTab === 'files' ? (
            <section className="monday-item-card-section monday-item-card-section-fill" role="tabpanel">
              <header><div><span>Evidence</span><h3>Customer files</h3><p>Photo evidence attached to completed field work. Access remains controlled by storage policy.</p></div></header>
              {evidenceFiles.length === 0 ? (
                <div className="monday-item-card-file-empty"><strong>No customer-linked files</strong><span>Field-service photo evidence will appear here when it is attached to completed work.</span></div>
              ) : (
                <div className="monday-item-card-file-list">
                  {evidenceFiles.map((closure) => (
                    <article key={closure.id}>
                      <div><strong>{fileName(closure.photo_path ?? '')}</strong><span>{closure.machine_barcode} · {closure.outcome.replace(/_/g, ' ')}</span><small>{formatDateTime(closure.closed_at)}{closure.site_address ? ` · ${closure.site_address}` : ''}</small></div>
                      <button className="button secondary" onClick={() => void openEvidence(closure)} type="button">Open</button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>

        <footer className="monday-item-card-footer">
          <span>{loading ? 'Refreshing related records…' : lastUpdated ? `Updated ${new Intl.DateTimeFormat('en-ZA', { timeStyle: 'short' }).format(lastUpdated)}` : 'Customer item'}</span>
          {customer ? <Link href={`/customers/${customer.id}`}>Open full customer workspace →</Link> : null}
        </footer>
      </aside>
    </div>
  );
}

function RelatedSection({ count, title, children }: { count: number; title: string; children: ReactNode }) {
  return (
    <section className="monday-item-card-section">
      <header><div><span>Related records</span><h3>{title}</h3></div><strong>{count}</strong></header>
      <div className="monday-item-card-related-list">{children}</div>
    </section>
  );
}

function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <div className="empty-state">No linked updates are available.</div>;
  return (
    <div className="monday-item-card-activity">
      {entries.map((entry) => {
        const content = (
          <>
            <span className="monday-item-card-activity-marker" aria-hidden="true" />
            <div><strong>{entry.title}</strong><span>{entry.detail}</span><small>{formatDateTime(entry.occurredAt)}</small></div>
            <StatusBadge value={entry.tone} />
          </>
        );
        return entry.href ? <Link href={entry.href} key={entry.id}>{content}</Link> : <article key={entry.id}>{content}</article>;
      })}
    </div>
  );
}
