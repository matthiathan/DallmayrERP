'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './CustomerSitesWorkspace.module.css';

type Customer = {
  id: string;
  branch: string;
  customer_code: string | null;
  customer_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string | null;
};

type Site = {
  id: string;
  customer_id: string;
  site_name: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: string | null;
};

type FleetRow = {
  id: string;
  customer_id: string | null;
  site_id: string | null;
  machine_name: string | null;
  model: string | null;
  serial_number: string | null;
  connection_status: 'online' | 'delayed' | 'offline' | 'never' | 'unlinked';
  fault_count: number;
  device_id: string | null;
  device_code: string | null;
  last_contact: string | null;
};

type FleetPayload = { rows?: FleetRow[]; total?: number; fleet_total?: number };

type ServiceJob = {
  id: string;
  customer_id: string | null;
  site_id: string | null;
  machine_id: string | null;
  job_number: string;
  priority: string;
  status: string;
  summary: string;
  due_at: string | null;
};

type CustomerSummary = {
  customer: Customer;
  sites: Site[];
  machines: FleetRow[];
  online: number;
  offline: number;
  faults: number;
  openJobs: number;
  health: number;
};

type CustomerDirectoryRow = {
  id: string;
  branch: string;
  customer_code: string | null;
  customer_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string | null;
  site_count: number;
  machine_count: number;
  online_count: number;
  offline_count: number;
  fault_count: number;
  open_job_count: number;
  health: number;
};

type CustomerDirectoryPayload = {
  rows?: CustomerDirectoryRow[];
  total?: number;
  summary?: {
    customers?: number;
    sites?: number;
    machines?: number;
    online?: number;
    faults?: number;
    open_jobs?: number;
  };
  limit?: number;
  offset?: number;
};

const terminalJobs = new Set(['completed', 'verified', 'closed', 'cancelled']);
const DIRECTORY_PAGE_SIZE = 50;

function machineName(machine: FleetRow) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? 'Unnamed machine';
}

function statusLabel(status: FleetRow['connection_status']) {
  if (status === 'unlinked') return 'No device';
  if (status === 'never') return 'Never connected';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function contactAge(value: string | null) {
  if (!value) return 'Never';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 2880) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function CustomerSitesWorkspace({ customerId = null }: { customerId?: string | null }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [machines, setMachines] = useState<FleetRow[]>([]);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [directoryRows, setDirectoryRows] = useState<CustomerDirectoryRow[]>([]);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [directorySummary, setDirectorySummary] = useState({ customers: 0, sites: 0, machines: 0, online: 0, faults: 0, openJobs: 0 });
  const [directoryPage, setDirectoryPage] = useState(0);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(customerId);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();

      if (!customerId) {
        const { data, error: directoryError } = await client.rpc('get_telemetry_customer_site_directory', {
          p_search: debouncedSearch,
          p_offset: directoryPage * DIRECTORY_PAGE_SIZE,
          p_limit: DIRECTORY_PAGE_SIZE,
        });
        if (directoryError) throw directoryError;
        const payload = (data ?? {}) as CustomerDirectoryPayload;
        const rows = (payload.rows ?? []).map((row) => ({
          ...row,
          site_count: Number(row.site_count ?? 0),
          machine_count: Number(row.machine_count ?? 0),
          online_count: Number(row.online_count ?? 0),
          offline_count: Number(row.offline_count ?? 0),
          fault_count: Number(row.fault_count ?? 0),
          open_job_count: Number(row.open_job_count ?? 0),
          health: Number(row.health ?? 0),
        }));
        const summary = payload.summary ?? {};
        setDirectoryRows(rows);
        setDirectoryTotal(Number(payload.total ?? 0));
        setDirectorySummary({
          customers: Number(summary.customers ?? 0),
          sites: Number(summary.sites ?? 0),
          machines: Number(summary.machines ?? 0),
          online: Number(summary.online ?? 0),
          faults: Number(summary.faults ?? 0),
          openJobs: Number(summary.open_jobs ?? 0),
        });
        setSelectedCustomerId((current) => current && rows.some((row) => row.id === current) ? current : null);
        setUpdatedAt(new Date());
        return;
      }

      const [customerResult, siteResult, fleetResult, jobsResult] = await Promise.all([
        client.from('customers').select('id,branch,customer_code,customer_name,phone,email,address,status').eq('id', customerId),
        client.from('customer_sites').select('id,customer_id,site_name,address,contact_name,contact_phone,status').eq('customer_id', customerId).order('site_name').limit(500),
        client.rpc('get_telemetry_machine_fleet', {
          p_search: '',
          p_branch: 'all',
          p_status: 'all',
          p_customer_id: customerId,
          p_site_id: null,
          p_commissioning: 'all',
          p_offset: 0,
          p_limit: 250,
        }),
        client.from('service_jobs').select('id,customer_id,site_id,machine_id,job_number,priority,status,summary,due_at').eq('customer_id', customerId).order('reported_at', { ascending: false }).limit(500),
      ]);
      const firstError = customerResult.error ?? siteResult.error ?? fleetResult.error ?? jobsResult.error;
      if (firstError) throw firstError;
      setCustomers((customerResult.data ?? []) as Customer[]);
      setSites((siteResult.data ?? []) as Site[]);
      setMachines((((fleetResult.data ?? {}) as FleetPayload).rows ?? []).map((row) => ({ ...row, fault_count: Number(row.fault_count ?? 0) })));
      setJobs((jobsResult.data ?? []) as ServiceJob[]);
      setUpdatedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load customers and sites.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customerId, debouncedSearch, directoryPage]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => globalThis.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setDirectoryPage(0); }, [debouncedSearch]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
    return () => globalThis.clearInterval(timer);
  }, [load]);

  const summaries = useMemo<CustomerSummary[]>(() => customers.map((customer) => {
    const customerSites = sites.filter((site) => site.customer_id === customer.id);
    const customerMachines = machines.filter((machine) => machine.customer_id === customer.id);
    const online = customerMachines.filter((machine) => machine.connection_status === 'online').length;
    const offline = customerMachines.filter((machine) => ['offline', 'never', 'unlinked'].includes(machine.connection_status)).length;
    const faults = customerMachines.reduce((sum, machine) => sum + machine.fault_count, 0);
    const openJobs = jobs.filter((job) => job.customer_id === customer.id && !terminalJobs.has(job.status)).length;
    const denominator = Math.max(1, customerMachines.length);
    const health = Math.max(0, Math.round(100 - ((offline / denominator) * 55) - (Math.min(faults, denominator) / denominator * 35)));
    return { customer, sites: customerSites, machines: customerMachines, online, offline, faults, openJobs, health };
  }), [customers, jobs, machines, sites]);

  const selectedSummary = summaries.find((item) => item.customer.id === customerId) ?? null;
  const selectedDirectory = selectedCustomerId ? directoryRows.find((item) => item.id === selectedCustomerId) ?? null : null;
  const selectedSite = selectedSiteId ? sites.find((site) => site.id === selectedSiteId) ?? null : null;
  const selectedSiteMachines = selectedSite ? machines.filter((machine) => machine.site_id === selectedSite.id) : [];

  const totals = useMemo(() => customerId ? ({
    customers: summaries.length,
    sites: sites.length,
    machines: machines.length,
    online: machines.filter((machine) => machine.connection_status === 'online').length,
    faults: machines.reduce((sum, machine) => sum + machine.fault_count, 0),
    openJobs: jobs.filter((job) => !terminalJobs.has(job.status)).length,
  }) : directorySummary, [customerId, directorySummary, jobs, machines, sites.length, summaries.length]);

  if (loading) return <HamsterLoader label="Loading customers and sites" />;

  if (customerId && !selectedSummary && !error) {
    return <section className={styles.notFound}><h1>Customer not found</h1><p>This customer is unavailable or outside your telemetry scope.</p><Link href="/customers">Back to customers</Link></section>;
  }

  if (customerId && selectedSummary) {
    const item = selectedSummary;
    const customerJobs = jobs.filter((job) => job.customer_id === item.customer.id);
    return <section className={styles.workspace}>
      <header className={styles.detailHeader}>
        <div><Link href="/customers">← Customers / Sites</Link><span>{item.customer.branch.toUpperCase()} · {item.customer.customer_code ?? 'No account code'}</span><h1>{item.customer.customer_name}</h1><p>{item.customer.address ?? 'No primary customer address recorded.'}</p></div>
        <button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      <section className={styles.metrics}>
        <article><span>Sites</span><strong>{item.sites.length}</strong><small>Operating locations</small></article>
        <article><span>Machines</span><strong>{item.machines.length}</strong><small>{item.online} online</small></article>
        <article><span>Fleet health</span><strong>{item.health}%</strong><small>{item.offline} needing connectivity attention</small></article>
        <article><span>Active faults</span><strong>{item.faults}</strong><small>Across customer fleet</small></article>
        <article><span>Open maintenance</span><strong>{item.openJobs}</strong><small>Service work in progress</small></article>
      </section>
      <section className={styles.detailGrid}>
        <article className={styles.panel}>
          <header><div><span>Customer footprint</span><h2>Sites</h2></div><strong>{item.sites.length}</strong></header>
          <div className={styles.siteList}>{item.sites.map((site) => {
            const siteMachines = item.machines.filter((machine) => machine.site_id === site.id);
            const siteOnline = siteMachines.filter((machine) => machine.connection_status === 'online').length;
            const siteFaults = siteMachines.reduce((sum, machine) => sum + machine.fault_count, 0);
            return <button key={site.id} onClick={() => setSelectedSiteId(site.id)} type="button">
              <div><strong>{site.site_name}</strong><span>{site.address ?? 'No site address'}</span></div>
              <div><b>{siteMachines.length} machines</b><small>{siteOnline} online · {siteFaults} faults</small></div>
            </button>;
          })}</div>
        </article>
        <article className={styles.panel}>
          <header><div><span>Installed base</span><h2>Machines</h2></div><Link href={`/machines?customer=${item.customer.id}`}>Open fleet</Link></header>
          <div className={styles.machineList}>{item.machines.slice(0, 12).map((machine) => <Link href={`/machines/${machine.id}`} key={machine.id}>
            <span className={`${styles.machineDot} ${styles[`dot_${machine.connection_status}`]}`} />
            <div><strong>{machineName(machine)}</strong><small>{sites.find((site) => site.id === machine.site_id)?.site_name ?? 'No site'} · {machine.device_code ?? 'No device'}</small></div>
            <div><b>{statusLabel(machine.connection_status)}</b><small>{machine.fault_count ? `${machine.fault_count} faults` : contactAge(machine.last_contact)}</small></div>
          </Link>)}</div>
        </article>
        <article className={styles.panel}>
          <header><div><span>Service relationship</span><h2>Maintenance</h2></div><Link href="/maintenance">Open maintenance</Link></header>
          <div className={styles.jobList}>{customerJobs.slice(0, 10).map((job) => <article key={job.id}>
            <div><strong>{job.job_number}</strong><span>{job.summary}</span></div>
            <div><b>{job.priority}</b><small>{job.status.replace(/_/g, ' ')}</small></div>
          </article>)}</div>
        </article>
        <article className={styles.panel}>
          <header><div><span>Primary information</span><h2>Customer contacts</h2></div></header>
          <dl className={styles.facts}>
            <div><dt>Telephone</dt><dd>{item.customer.phone ?? 'Not recorded'}</dd></div>
            <div><dt>Email</dt><dd>{item.customer.email ?? 'Not recorded'}</dd></div>
            <div><dt>Branch / region</dt><dd>{item.customer.branch.toUpperCase()}</dd></div>
            <div><dt>Status</dt><dd>{item.customer.status ?? 'Active'}</dd></div>
          </dl>
        </article>
      </section>
      {selectedSite ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedSiteId(null); }}>
        <aside className={styles.drawer} aria-label="Site details">
          <header><div><span>Site details</span><h2>{selectedSite.site_name}</h2><p>{selectedSite.address ?? 'No address recorded'}</p></div><button onClick={() => setSelectedSiteId(null)} type="button">×</button></header>
          <dl className={styles.facts}><div><dt>Contact</dt><dd>{selectedSite.contact_name ?? 'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{selectedSite.contact_phone ?? 'Not recorded'}</dd></div><div><dt>Status</dt><dd>{selectedSite.status ?? 'Active'}</dd></div><div><dt>Machines</dt><dd>{selectedSiteMachines.length}</dd></div></dl>
          <section className={styles.drawerMachines}>{selectedSiteMachines.map((machine) => <Link href={`/machines/${machine.id}`} key={machine.id}><div><strong>{machineName(machine)}</strong><span>{machine.device_code ?? 'No telemetry device'}</span></div><b>{statusLabel(machine.connection_status)}</b></Link>)}</section>
        </aside>
      </div> : null}
    </section>;
  }

  return <section className={styles.workspace}>
    <header className={styles.header}><div><span>Fleet</span><h1>Customers / Sites</h1><p>Customer hierarchy, site health, installed machines and service context.</p></div><button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button></header>
    {error ? <div className={styles.error}>{error}</div> : null}
    <section className={styles.metrics}>
      <article><span>Customers</span><strong>{totals.customers}</strong><small>Accounts in scope</small></article>
      <article><span>Sites</span><strong>{totals.sites}</strong><small>Operating locations</small></article>
      <article><span>Machines</span><strong>{totals.machines}</strong><small>{totals.online} online</small></article>
      <article><span>Active faults</span><strong>{totals.faults}</strong><small>Across all customers</small></article>
      <article><span>Open maintenance</span><strong>{totals.openJobs}</strong><small>Current service work</small></article>
    </section>
    <section className={styles.toolbar}><label><NavigationIcon kind="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, code, site or address" /></label><span>{directoryTotal} matching customers · updated {updatedAt ? updatedAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></section>
    <section className={styles.directory}>
      <header><span>Customer</span><span>Sites</span><span>Machines</span><span>Fleet health</span><span>Faults</span><span>Service</span><span /></header>
      {directoryRows.map((item) => <article key={item.id}>
        <button className={styles.customerCell} onClick={() => setSelectedCustomerId(item.id)} type="button"><strong>{item.customer_name}</strong><small>{item.customer_code ?? 'No account code'} · {item.branch.toUpperCase()}</small></button>
        <span>{item.site_count}</span><span>{item.machine_count}<small>{item.online_count} online</small></span>
        <span className={styles.health}><i style={{ width: `${item.health}%` }} /><b>{item.health}%</b></span>
        <span className={item.fault_count ? styles.attention : ''}>{item.fault_count}</span>
        <span>{item.open_job_count}<small>open</small></span>
        <Link href={`/customers/${item.id}`}>Open</Link>
      </article>)}
      {!directoryRows.length ? <div className={styles.empty}>No customers match this search in the selected telemetry region.</div> : null}
    </section>
    <nav className={styles.pagination} aria-label="Customer directory pages">
      <button disabled={directoryPage === 0 || refreshing} onClick={() => setDirectoryPage((page) => Math.max(0, page - 1))} type="button">Previous</button>
      <span>Page {directoryPage + 1} of {Math.max(1, Math.ceil(directoryTotal / DIRECTORY_PAGE_SIZE))}</span>
      <button disabled={(directoryPage + 1) * DIRECTORY_PAGE_SIZE >= directoryTotal || refreshing} onClick={() => setDirectoryPage((page) => page + 1)} type="button">Next</button>
    </nav>
    {selectedDirectory ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedCustomerId(null); }}>
      <aside className={styles.drawer} aria-label="Customer quick preview">
        <header><div><span>Customer preview</span><h2>{selectedDirectory.customer_name}</h2><p>{selectedDirectory.customer_code ?? 'No account code'} · {selectedDirectory.branch.toUpperCase()}</p></div><button onClick={() => setSelectedCustomerId(null)} type="button">×</button></header>
        <section className={styles.previewMetrics}><div><span>Sites</span><strong>{selectedDirectory.site_count}</strong></div><div><span>Machines</span><strong>{selectedDirectory.machine_count}</strong></div><div><span>Health</span><strong>{selectedDirectory.health}%</strong></div></section>
        <dl className={styles.facts}><div><dt>Address</dt><dd>{selectedDirectory.address ?? 'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{selectedDirectory.phone ?? 'Not recorded'}</dd></div><div><dt>Email</dt><dd>{selectedDirectory.email ?? 'Not recorded'}</dd></div><div><dt>Online</dt><dd>{selectedDirectory.online_count}</dd></div><div><dt>Offline / unlinked</dt><dd>{selectedDirectory.offline_count}</dd></div><div><dt>Active faults</dt><dd>{selectedDirectory.fault_count}</dd></div><div><dt>Open maintenance</dt><dd>{selectedDirectory.open_job_count}</dd></div></dl>
        <footer><Link href={`/customers/${selectedDirectory.id}`}>Open customer workspace</Link><Link href={`/machines?customer=${selectedDirectory.id}`}>View machines</Link></footer>
      </aside>
    </div> : null}
  </section>;
}