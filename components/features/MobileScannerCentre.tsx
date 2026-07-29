'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { BusinessRole } from '@/types/dallmayrerp';
import styles from './MobileScannerCentre.module.css';

type Relation<T> = T | T[] | null;

type MachineResult = {
  id: string;
  branch: string;
  machine_name: string | null;
  model: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  asset_tag: string | null;
  status: string;
  condition: string | null;
};

type StockResult = {
  id: string;
  stock_name: string;
  sku: string | null;
  item_barcode: string;
  box_barcode: string | null;
  item_quantity: number;
  box_quantity: number;
  items_per_box: number | null;
  warehouse_location: string | null;
  reorder_level: number;
  is_active: boolean;
};

type CustomerRelation = {
  customer_name: string | null;
  phone: string | null;
  address: string | null;
};

type SiteRelation = {
  site_name: string | null;
  address: string | null;
};

type AssignedJobResult = {
  id: string;
  job_number: string;
  incident_number: string;
  machine_id: string | null;
  summary: string;
  priority: string;
  status: string;
  due_at: string | null;
  customer_name_snapshot: string | null;
  address_snapshot: string | null;
  customers: Relation<CustomerRelation>;
  customer_sites: Relation<SiteRelation>;
};

const machineRoles = new Set<BusinessRole>(['admin', 'operations', 'technician', 'road_technician']);
const stockRoles = new Set<BusinessRole>(['admin', 'operations', 'warehouse_staff']);
const fieldRoles = new Set<BusinessRole>(['technician', 'road_technician']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstRelation<T>(relation: Relation<T> | undefined): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

function extractLookupCode(rawValue: string) {
  const clean = rawValue.trim().replace(/^\uFEFF/, '');
  if (!clean) return '';

  try {
    const url = new URL(clean);
    const fromQuery = ['code', 'barcode', 'serial', 'asset', 'tag', 'sku']
      .map((key) => url.searchParams.get(key)?.trim())
      .find(Boolean);
    if (fromQuery) return fromQuery;

    const pathValue = url.pathname.split('/').filter(Boolean).at(-1);
    return pathValue ? decodeURIComponent(pathValue) : clean;
  } catch {
    return clean;
  }
}

function formatDue(value: string | null) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Due date unavailable';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function directionsHref(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function machineLabel(machine: MachineResult) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? machine.machine_barcode ?? machine.asset_tag ?? 'Machine record';
}

function collectUnique<T extends { id: string }>(responses: Array<{ data: unknown; error: { message: string } | null }>) {
  const records = new Map<string, T>();
  for (const response of responses) {
    if (response.error) throw new Error(response.error.message);
    for (const row of (response.data ?? []) as T[]) records.set(row.id, row);
  }
  return Array.from(records.values());
}

export function MobileScannerCentre() {
  const { businessUser, userDetails } = useAuth();
  const role = userDetails?.role;
  const canViewMachines = Boolean(role && machineRoles.has(role));
  const canViewStock = Boolean(role && stockRoles.has(role));
  const isFieldUser = Boolean(role && fieldRoles.has(role));
  const [scanValue, setScanValue] = useState('');
  const [interpretedCode, setInterpretedCode] = useState('');
  const [machines, setMachines] = useState<MachineResult[]>([]);
  const [stockItems, setStockItems] = useState<StockResult[]>([]);
  const [assignedJobs, setAssignedJobs] = useState<AssignedJobResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const lastAutomaticLookupRef = useRef('');

  const quickLinks = useMemo(() => {
    if (role === 'technician') return [
      { href: '/technician', label: 'My technician jobs' },
      { href: '/operations/assets', label: 'Machine master' },
      { href: '/work', label: 'Action centre' },
    ];
    if (role === 'road_technician') return [
      { href: '/road-tech', label: 'My field jobs' },
      { href: '/operations/assets', label: 'Machine master' },
      { href: '/work', label: 'Action centre' },
    ];
    if (role === 'warehouse_staff') return [
      { href: '/warehouse/stock', label: 'Stock control' },
      { href: '/warehouse/purchasing', label: 'Purchase orders' },
      { href: '/warehouse/traceability', label: 'Lots and serials' },
    ];
    return [
      { href: '/operations/assets', label: 'Machine master' },
      { href: '/warehouse/stock', label: 'Stock control' },
      { href: '/operations/exceptions', label: 'Exception centre' },
    ];
  }, [role]);

  const lookup = useCallback(async (rawValue: string) => {
    const code = extractLookupCode(rawValue);
    setInterpretedCode(code);
    setSearched(Boolean(code));
    setError(null);
    setMachines([]);
    setStockItems([]);
    setAssignedJobs([]);
    if (!code) return;

    const requestId = ++requestRef.current;
    setLoading(true);
    const client = getSupabaseClient();

    try {
      let nextMachines: MachineResult[] = [];
      let nextStock: StockResult[] = [];

      if (canViewMachines) {
        const select = 'id, branch, machine_name, model, serial_number, machine_barcode, asset_tag, status, condition';
        const machineResponses = await Promise.all([
          client.from('machines').select(select).eq('machine_barcode', code).limit(12),
          client.from('machines').select(select).eq('serial_number', code).limit(12),
          client.from('machines').select(select).eq('asset_tag', code).limit(12),
        ]);
        if (uuidPattern.test(code)) {
          machineResponses.push(await client.from('machines').select(select).eq('id', code).limit(1));
        }
        nextMachines = collectUnique<MachineResult>(machineResponses);
      }

      if (canViewStock) {
        const select = 'id, stock_name, sku, item_barcode, box_barcode, item_quantity, box_quantity, items_per_box, warehouse_location, reorder_level, is_active';
        const stockResponses = await Promise.all([
          client.from('stock_items').select(select).eq('item_barcode', code).limit(12),
          client.from('stock_items').select(select).eq('box_barcode', code).limit(12),
          client.from('stock_items').select(select).eq('sku', code).limit(12),
        ]);
        if (uuidPattern.test(code)) {
          stockResponses.push(await client.from('stock_items').select(select).eq('id', code).limit(1));
        }
        nextStock = collectUnique<StockResult>(stockResponses);
      }

      let nextJobs: AssignedJobResult[] = [];
      if (isFieldUser && businessUser) {
        const select = 'id, job_number, incident_number, machine_id, summary, priority, status, due_at, customer_name_snapshot, address_snapshot, customers(customer_name, phone, address), customer_sites(site_name, address)';
        const jobResponses = await Promise.all([
          client.from('service_jobs').select(select).eq('assigned_to', businessUser.id).in('status', ['assigned', 'in_progress']).eq('job_number', code).limit(12),
          client.from('service_jobs').select(select).eq('assigned_to', businessUser.id).in('status', ['assigned', 'in_progress']).eq('incident_number', code).limit(12),
        ]);
        const machineIds = nextMachines.map((machine) => machine.id);
        if (machineIds.length > 0) {
          jobResponses.push(await client.from('service_jobs').select(select).eq('assigned_to', businessUser.id).in('status', ['assigned', 'in_progress']).in('machine_id', machineIds).limit(20));
        }
        nextJobs = collectUnique<AssignedJobResult>(jobResponses);
      }

      if (requestId !== requestRef.current) return;
      setMachines(nextMachines);
      setStockItems(nextStock);
      setAssignedJobs(nextJobs);
    } catch (lookupError) {
      if (requestId !== requestRef.current) return;
      setError(lookupError instanceof Error ? lookupError.message : 'The scanned code could not be looked up.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [businessUser, canViewMachines, canViewStock, isFieldUser]);

  useEffect(() => {
    const clean = scanValue.trim();
    if (clean.length < 3 || clean === lastAutomaticLookupRef.current) return;
    const handle = window.setTimeout(() => {
      lastAutomaticLookupRef.current = clean;
      void lookup(clean);
    }, 420);
    return () => window.clearTimeout(handle);
  }, [lookup, scanValue]);

  function clearScan() {
    requestRef.current += 1;
    lastAutomaticLookupRef.current = '';
    setScanValue('');
    setInterpretedCode('');
    setMachines([]);
    setStockItems([]);
    setAssignedJobs([]);
    setLoading(false);
    setSearched(false);
    setError(null);
  }

  const resultCount = machines.length + stockItems.length + assignedJobs.length;
  const jobRoute = role === 'road_technician' ? '/road-tech' : '/technician';

  return (
    <div className={styles.stage}>
      <section className={styles.intro}>
        <span>Mobile scanner centre</span>
        <h1>Scan and act</h1>
        <p>Scan a machine, stock item, box, serial number, asset tag, SKU, assigned job or incident number. Results are limited by your role and branch permissions.</p>
      </section>

      <section aria-busy={loading} className={styles.scannerPanel}>
        <BarcodeCapture label="Machine, stock or job code" onChange={setScanValue} value={scanValue} />
        {interpretedCode && interpretedCode !== scanValue.trim() ? (
          <div className={styles.interpretedCode}><span>Code extracted from scan</span><strong>{interpretedCode}</strong></div>
        ) : null}
        <div className={styles.lookupActions}>
          <button className="button" disabled={loading || !scanValue.trim()} onClick={() => { lastAutomaticLookupRef.current = scanValue.trim(); void lookup(scanValue); }} type="button">
            {loading ? 'Finding record…' : 'Find record'}
          </button>
          <button className="button secondary" disabled={loading && !scanValue} onClick={clearScan} type="button">Clear</button>
        </div>
        {error ? <div className={`${styles.status} ${styles.statusError}`} role="alert">{error}</div> : null}
        {!error && loading ? <div className={styles.status} role="status">Checking the records available to your role…</div> : null}
        {!error && searched && !loading && resultCount === 0 ? <div className={styles.status} role="status">No accessible machine, stock item or assigned job matched this code.</div> : null}
      </section>

      {assignedJobs.length > 0 ? (
        <section className={styles.resultsSection}>
          <div className={styles.sectionHeading}><div><span>Field service</span><h2>Assigned jobs</h2><p>Open the matching job or use the customer and site shortcuts.</p></div><strong>{assignedJobs.length}</strong></div>
          <div className={styles.resultList}>
            {assignedJobs.map((job) => {
              const customer = firstRelation(job.customers);
              const site = firstRelation(job.customer_sites);
              const address = site?.address ?? job.address_snapshot ?? customer?.address ?? '';
              const customerName = job.customer_name_snapshot ?? customer?.customer_name ?? 'Customer not set';
              return (
                <article className={styles.resultCard} key={job.id}>
                  <div className={styles.resultHeader}><div><span className={styles.resultType}>Assigned job</span><h3>{job.job_number}</h3><p>{job.summary}</p></div><StatusBadge value={job.status} /></div>
                  <dl className={styles.resultMeta}>
                    <div><dt>Customer</dt><dd>{customerName}</dd></div>
                    <div><dt>Site</dt><dd>{site?.site_name ?? address || 'Not recorded'}</dd></div>
                    <div><dt>Priority</dt><dd>{job.priority.replace(/_/g, ' ')}</dd></div>
                    <div><dt>Due</dt><dd>{formatDue(job.due_at)}</dd></div>
                  </dl>
                  <div className={styles.resultActions}>
                    <Link className="button" href={`${jobRoute}?job=${encodeURIComponent(job.job_number)}`}>Open assigned job</Link>
                    {customer?.phone ? <a className="button secondary" href={`tel:${customer.phone}`}>Call customer</a> : null}
                    {address ? <a className="button secondary" href={directionsHref(address)} rel="noreferrer" target="_blank">Directions</a> : null}
                    {job.machine_id ? <Link className="button secondary" href={`/operations/assets/${job.machine_id}`}>Open machine</Link> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {machines.length > 0 ? (
        <section className={styles.resultsSection}>
          <div className={styles.sectionHeading}><div><span>Assets</span><h2>Machine matches</h2><p>Review the machine identity and open its authoritative record.</p></div><strong>{machines.length}</strong></div>
          <div className={styles.resultList}>
            {machines.map((machine) => (
              <article className={styles.resultCard} key={machine.id}>
                <div className={styles.resultHeader}><div><span className={styles.resultType}>Machine</span><h3>{machineLabel(machine)}</h3><p>{machine.model ?? 'Model not recorded'}</p></div><StatusBadge value={machine.status} /></div>
                <dl className={styles.resultMeta}>
                  <div><dt>Branch</dt><dd>{machine.branch.toUpperCase()}</dd></div>
                  <div><dt>Condition</dt><dd>{machine.condition ?? 'Not recorded'}</dd></div>
                  <div><dt>Serial</dt><dd>{machine.serial_number ?? 'Not recorded'}</dd></div>
                  <div><dt>Asset tag</dt><dd>{machine.asset_tag ?? machine.machine_barcode ?? 'Not recorded'}</dd></div>
                </dl>
                <div className={styles.resultActions}><Link className="button" href={`/operations/assets/${machine.id}`}>Open machine record</Link></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {stockItems.length > 0 ? (
        <section className={styles.resultsSection}>
          <div className={styles.sectionHeading}><div><span>Inventory</span><h2>Stock matches</h2><p>Review quantity and location, then open the stock record for permitted transactions.</p></div><strong>{stockItems.length}</strong></div>
          <div className={styles.resultList}>
            {stockItems.map((item) => {
              const units = item.item_quantity + item.box_quantity * (item.items_per_box ?? 1);
              const risk = units <= item.reorder_level ? 'critical' : item.is_active ? 'active' : 'inactive';
              return (
                <article className={styles.resultCard} key={item.id}>
                  <div className={styles.resultHeader}><div><span className={styles.resultType}>Stock item</span><h3>{item.stock_name}</h3><p>{item.sku ?? item.item_barcode}</p></div><StatusBadge label={units <= item.reorder_level ? 'Low stock' : risk} value={risk} /></div>
                  <dl className={styles.resultMeta}>
                    <div><dt>Total units</dt><dd>{units.toLocaleString()}</dd></div>
                    <div><dt>Location</dt><dd>{item.warehouse_location ?? 'Not recorded'}</dd></div>
                    <div><dt>Item barcode</dt><dd>{item.item_barcode}</dd></div>
                    <div><dt>Box barcode</dt><dd>{item.box_barcode ?? 'Not recorded'}</dd></div>
                  </dl>
                  <div className={styles.resultActions}><Link className="button" href={`/warehouse/stock/${item.id}`}>Open stock record</Link><Link className="button secondary" href={`/warehouse/stock?stock=${item.id}`}>Open stock control</Link></div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className={styles.shortcutSection}>
        <div className={styles.sectionHeading}><div><span>Quick actions</span><h2>Continue working</h2><p>Open the most useful operational pages for your role.</p></div></div>
        <div className={styles.shortcutGrid}>{quickLinks.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}</div>
      </section>
    </div>
  );
}
