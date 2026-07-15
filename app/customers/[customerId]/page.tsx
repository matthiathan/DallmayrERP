'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { CustomerRecord } from '@/types/enterprise-records';

type SiteRow = { id: string; site_name: string; address: string | null; contact_name: string | null; contact_phone: string | null; status: string | null };
type MachineRow = { id: string; machine_name: string | null; model: string | null; serial_number: string | null; machine_barcode: string | null; status: string };
type ContractRow = { id: string; contract_number: string | null; contract_type: string | null; start_date: string | null; end_date: string | null; status: string | null };
type ServiceRow = { id: string; job_number: string; summary: string; priority: string; status: string; due_at: string | null };
type DeliveryRow = { id: string; order_number: string; status: string; branch: string; delivery_address: string | null; created_at: string };

export default function CustomerProfilePage() {
  const { customerId } = useParams<{ customerId: string }>();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [jobs, setJobs] = useState<ServiceRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function loadProfile() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const customerResult = await client.from('customers').select('id, customer_name, customer_code, branch, phone, email, address, status').eq('id', customerId).single();
    if (customerResult.error) {
      setError(customerResult.error.message);
      setLoading(false);
      return;
    }
    const customerData = customerResult.data as CustomerRecord;
    setCustomer(customerData);
    const [siteResult, machineResult, contractResult, jobResult, deliveryResult] = await Promise.all([
      client.from('customer_sites').select('id, site_name, address, contact_name, contact_phone, status').eq('customer_id', customerId).order('site_name'),
      client.from('machines').select('id, machine_name, model, serial_number, machine_barcode, status').eq('customer_id', customerId).order('machine_name'),
      client.from('contracts').select('id, contract_number, contract_type, start_date, end_date, status').eq('customer_id', customerId).order('end_date'),
      client.from('service_jobs').select('id, job_number, summary, priority, status, due_at').eq('customer_id', customerId).order('created_at', { ascending: false }),
      client.from('delivery_orders').select('id, order_number, status, branch, delivery_address, created_at').eq('customer_name', customerData.customer_name).order('created_at', { ascending: false }),
    ]);
    const firstError = siteResult.error ?? machineResult.error ?? contractResult.error ?? jobResult.error ?? deliveryResult.error;
    if (firstError) setError(firstError.message);
    setSites((siteResult.data ?? []) as SiteRow[]);
    setMachines((machineResult.data ?? []) as MachineRow[]);
    setContracts((contractResult.data ?? []) as ContractRow[]);
    setJobs((jobResult.data ?? []) as ServiceRow[]);
    setDeliveries((deliveryResult.data ?? []) as DeliveryRow[]);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    loadProfile().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load customer profile.');
      setLoading(false);
    });
  }, [customerId]);

  if (loading && !customer) return <AppShell><div className="neo-card"><h2>Loading Customer 360...</h2></div></AppShell>;

  return (
    <AppShell>
      {error ? <div className="error">{error}</div> : null}
      {!customer ? <div className="neo-card"><h1>Customer not found</h1><Link className="button" href="/customers">Back to directory</Link></div> : (
        <div className="grid spatial-stage spatial-dashboard">
          <div className="page-header hero-panel spatial-card"><div><div className="badge">Customer 360</div><h1>{customer.customer_name}</h1><p>{customer.customer_code ?? 'No account code'} • {customer.branch.toUpperCase()}</p><div className="feature-list"><StatusBadge value={customer.status ?? 'unknown'} /><span className="feature-pill">{customer.phone ?? 'No phone'}</span><span className="feature-pill">{customer.email ?? 'No email'}</span></div><p>{customer.address ?? 'No address recorded.'}</p></div></div>
          <div className="grid grid-3 spatial-kpi-grid"><div className="card"><div className="nav-heading">Sites</div><div className="kpi-value">{sites.length}</div></div><div className="card"><div className="nav-heading">Machines</div><div className="kpi-value">{machines.length}</div></div><div className="card"><div className="nav-heading">Contracts</div><div className="kpi-value">{contracts.length}</div></div><div className="card"><div className="nav-heading">Open jobs</div><div className="kpi-value">{jobs.filter((job) => !['closed', 'cancelled'].includes(job.status)).length}</div></div><div className="card"><div className="nav-heading">Deliveries</div><div className="kpi-value">{deliveries.length}</div></div></div>
          <PageToolbar actions={<><Link className="button" href="/operations/service-jobs">Create service job</Link><button className="button secondary" onClick={loadProfile} type="button">Refresh</button></>} description="Unified customer, site, asset, contract and operating history." lastUpdated={lastUpdated} title="Customer workspace" />
          <section className="neo-card"><h2>Sites</h2><div className="grid grid-3">{sites.length ? sites.map((site) => <article className="card" key={site.id}><div className="page-toolbar-heading"><strong>{site.site_name}</strong><StatusBadge value={site.status ?? 'active'} /></div><p>{site.address ?? 'No address'}<br />{site.contact_name ?? 'No contact'}<br />{site.contact_phone ?? 'No phone'}</p></article>) : <div className="feature-pill">No sites linked</div>}</div></section>
          <section className="neo-card spatial-machine-panel"><h2>Machines</h2><div className="grid grid-3">{machines.length ? machines.map((machine) => <article className="card" key={machine.id}><div className="page-toolbar-heading"><strong>{machine.machine_name ?? machine.serial_number ?? 'Unnamed machine'}</strong><StatusBadge value={machine.status} /></div><p>{machine.model ?? 'No model'}<br />Serial: {machine.serial_number ?? '-'}<br />QR: {machine.machine_barcode ?? '-'}</p></article>) : <div className="feature-pill">No machines linked</div>}</div></section>
          <div className="grid grid-2"><section className="neo-card"><h2>Contracts</h2><div className="grid">{contracts.length ? contracts.map((contract) => <article className="card" key={contract.id}><div className="page-toolbar-heading"><strong>{contract.contract_number ?? 'Contract'}</strong><StatusBadge value={contract.status ?? 'unknown'} /></div><p>{contract.contract_type ?? 'No type'}<br />{contract.start_date ?? '-'} to {contract.end_date ?? '-'}</p></article>) : <div className="feature-pill">No contracts linked</div>}</div></section><section className="neo-card"><h2>Recent service jobs</h2><div className="grid">{jobs.length ? jobs.slice(0, 12).map((job) => <article className="card" key={job.id}><div className="page-toolbar-heading"><strong>{job.job_number}</strong><StatusBadge value={job.status} /></div><p>{job.summary}</p><StatusBadge value={job.priority} /></article>) : <div className="feature-pill">No jobs linked</div>}</div></section></div>
          <section className="neo-card spatial-route-panel"><h2>Delivery history</h2><div className="grid grid-3">{deliveries.length ? deliveries.slice(0, 18).map((delivery) => <article className="card" key={delivery.id}><div className="page-toolbar-heading"><strong>{delivery.order_number}</strong><StatusBadge value={delivery.status} /></div><p>{delivery.branch.toUpperCase()}<br />{delivery.delivery_address ?? 'No address'}<br />{new Date(delivery.created_at).toLocaleString()}</p></article>) : <div className="feature-pill">No deliveries found</div>}</div></section>
        </div>
      )}
    </AppShell>
  );
}
