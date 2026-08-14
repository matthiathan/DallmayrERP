'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { canAccessPath } from '@/lib/auth/permissions';
import {
  connectedRecordHref,
  getConnectedRecordRequest,
  isTerminalConnectedStatus,
  pathnameFromConnectedHref,
  type ConnectedRecordKind,
} from '@/lib/navigation/connectedWorkflows';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { BusinessRole } from '@/types/dallmayrerp';

type WorkflowLink = {
  href: string;
  label: string;
  kind: ConnectedRecordKind;
};

type WorkflowContext = {
  title: string;
  description: string;
  links: WorkflowLink[];
  signals: string[];
};

type CustomerRow = { id: string; customer_name: string };
type MachineRow = { id: string; machine_name: string | null; serial_number: string | null; customer_id: string | null };
type ServiceRow = { id: string; job_number: string; summary: string | null; status: string; assigned_to: string | null; customer_id: string | null; machine_id: string | null; created_at: string };
type WorkRow = { id: string; work_number: string; title: string; status: string; customer_id: string | null; machine_id: string | null; stock_item_id: string | null; created_at: string };
type DeliveryRow = { id: string; order_number: string; customer_name: string; status: string; created_at: string };
type StockRow = { id: string; stock_name: string };
type PartRow = { work_item_id: string; stock_item_id: string; quantity: number; stock_items?: { stock_name: string | null } | Array<{ stock_name: string | null }> | null };
type AssignableUserRow = { user_id: string; display_name: string };

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function recordLabel(value: string | null | undefined, fallback: string) {
  const clean = value?.trim();
  return clean || fallback;
}

function sortOpenFirst<T extends { status: string; created_at: string }>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const leftTerminal = isTerminalConnectedStatus(left.status) ? 1 : 0;
    const rightTerminal = isTerminalConnectedStatus(right.status) ? 1 : 0;
    if (leftTerminal !== rightTerminal) return leftTerminal - rightTerminal;
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
}

function uniqueLinks(links: WorkflowLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.href)) return false;
    seen.add(link.href);
    return true;
  });
}

function allowedLinks(role: BusinessRole, links: WorkflowLink[]) {
  return uniqueLinks(links).filter((link) => canAccessPath(role, pathnameFromConnectedHref(link.href)));
}

async function loadCustomerContext(customerId: string): Promise<WorkflowContext | null> {
  const client = getSupabaseClient();
  const customerResult = await client.from('customers').select('id, customer_name').eq('id', customerId).single();
  if (customerResult.error || !customerResult.data) return null;
  const customer = customerResult.data as CustomerRow;

  const [machinesResult, servicesResult, workResult, contractsResult, deliveriesResult] = await Promise.all([
    client.from('machines').select('id, machine_name, serial_number, customer_id').eq('customer_id', customerId).order('machine_name').limit(20),
    client.from('service_jobs').select('id, job_number, summary, status, assigned_to, customer_id, machine_id, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    client.from('work_items').select('id, work_number, title, status, customer_id, machine_id, stock_item_id, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    client.from('contracts').select('id').eq('customer_id', customerId).limit(200),
    client.from('delivery_orders').select('id, order_number, customer_name, status, created_at').eq('customer_name', customer.customer_name).order('created_at', { ascending: false }).limit(50),
  ]);

  const machines = (machinesResult.data ?? []) as MachineRow[];
  const services = sortOpenFirst((servicesResult.data ?? []) as ServiceRow[]);
  const work = sortOpenFirst((workResult.data ?? []) as WorkRow[]);
  const deliveries = sortOpenFirst((deliveriesResult.data ?? []) as DeliveryRow[]);
  const contractCount = contractsResult.data?.length ?? 0;
  const openServices = services.filter((row) => !isTerminalConnectedStatus(row.status));
  const openWork = work.filter((row) => !isTerminalConnectedStatus(row.status));
  const openDeliveries = deliveries.filter((row) => !isTerminalConnectedStatus(row.status));

  const links: WorkflowLink[] = [
    ...machines.slice(0, 2).map((machine) => ({
      href: connectedRecordHref('machine', machine.id),
      label: `Machine · ${recordLabel(machine.machine_name, machine.serial_number ?? 'Asset')}`,
      kind: 'machine' as const,
    })),
    ...openServices.slice(0, 2).map((job) => ({ href: connectedRecordHref('service', job.id), label: `Service · ${job.job_number}`, kind: 'service' as const })),
    ...openWork.slice(0, 2).map((item) => ({ href: connectedRecordHref('work', item.id), label: `Work · ${item.work_number}`, kind: 'work' as const })),
    ...openDeliveries.slice(0, 1).map((order) => ({ href: connectedRecordHref('delivery', order.id), label: `Delivery · ${order.order_number}`, kind: 'delivery' as const })),
  ];

  return {
    title: customer.customer_name,
    description: 'Customer-connected records: move straight into active assets, service, work and deliveries.',
    links,
    signals: [
      `${machines.length} machine${machines.length === 1 ? '' : 's'}`,
      `${openServices.length} open service`,
      `${openWork.length} open work`,
      `${openDeliveries.length} open deliveries`,
      `${contractCount} contract${contractCount === 1 ? '' : 's'}`,
    ],
  };
}

async function loadMachineContext(machineId: string): Promise<WorkflowContext | null> {
  const client = getSupabaseClient();
  const machineResult = await client.from('machines').select('id, machine_name, serial_number, customer_id').eq('id', machineId).single();
  if (machineResult.error || !machineResult.data) return null;
  const machine = machineResult.data as MachineRow;

  const [servicesResult, workResult, userResult] = await Promise.all([
    client.from('service_jobs').select('id, job_number, summary, status, assigned_to, customer_id, machine_id, created_at').eq('machine_id', machineId).order('created_at', { ascending: false }).limit(100),
    client.from('work_items').select('id, work_number, title, status, customer_id, machine_id, stock_item_id, created_at').eq('machine_id', machineId).order('created_at', { ascending: false }).limit(100),
    client.rpc('list_assignable_users'),
  ]);

  const services = sortOpenFirst((servicesResult.data ?? []) as ServiceRow[]);
  const work = sortOpenFirst((workResult.data ?? []) as WorkRow[]);
  const openService = services.find((row) => !isTerminalConnectedStatus(row.status)) ?? null;
  const openWork = work.find((row) => !isTerminalConnectedStatus(row.status)) ?? null;
  const workIds = work.map((row) => row.id);
  let parts: PartRow[] = [];
  if (workIds.length > 0) {
    const partsResult = await client.from('work_parts_used').select('work_item_id, stock_item_id, quantity, stock_items(stock_name)').in('work_item_id', workIds).order('created_at', { ascending: false }).limit(50);
    parts = (partsResult.data ?? []) as PartRow[];
  }

  const users = (userResult.data ?? []) as AssignableUserRow[];
  const userMap = new Map(users.map((user) => [user.user_id, user.display_name]));
  const technician = openService?.assigned_to ? userMap.get(openService.assigned_to) ?? 'Assigned technician' : 'Unassigned';
  const links: WorkflowLink[] = [];
  if (machine.customer_id) links.push({ href: connectedRecordHref('customer', machine.customer_id), label: 'Open customer', kind: 'customer' });
  if (openService) links.push({ href: connectedRecordHref('service', openService.id), label: `Current service · ${openService.job_number}`, kind: 'service' });
  if (openWork) links.push({ href: connectedRecordHref('work', openWork.id), label: `Current work · ${openWork.work_number}`, kind: 'work' });
  parts.slice(0, 2).forEach((part) => {
    const stock = firstRelation(part.stock_items);
    links.push({ href: connectedRecordHref('stock', part.stock_item_id), label: `Part · ${recordLabel(stock?.stock_name, 'Stock item')}`, kind: 'stock' });
  });

  return {
    title: recordLabel(machine.machine_name, machine.serial_number ?? 'Machine'),
    description: 'Machine-connected records: customer, current service, linked work and parts used on maintenance work.',
    links,
    signals: [
      `Technician · ${technician}`,
      `${services.length} service record${services.length === 1 ? '' : 's'}`,
      `${work.length} work item${work.length === 1 ? '' : 's'}`,
      `${parts.length} part entr${parts.length === 1 ? 'y' : 'ies'}`,
    ],
  };
}

async function loadWorkContext(workId: string): Promise<WorkflowContext | null> {
  const client = getSupabaseClient();
  const result = await client.from('work_items').select('id, work_number, title, status, customer_id, machine_id, stock_item_id, created_at').eq('id', workId).single();
  if (result.error || !result.data) return null;
  const work = result.data as WorkRow;
  const links: WorkflowLink[] = [];
  if (work.customer_id) links.push({ href: connectedRecordHref('customer', work.customer_id), label: 'Open customer', kind: 'customer' });
  if (work.machine_id) links.push({ href: connectedRecordHref('machine', work.machine_id), label: 'Open machine', kind: 'machine' });
  if (work.stock_item_id) links.push({ href: connectedRecordHref('stock', work.stock_item_id), label: 'Open linked stock', kind: 'stock' });

  if (work.machine_id) {
    const serviceResult = await client.from('service_jobs').select('id, job_number, summary, status, assigned_to, customer_id, machine_id, created_at').eq('machine_id', work.machine_id).order('created_at', { ascending: false }).limit(20);
    const currentService = sortOpenFirst((serviceResult.data ?? []) as ServiceRow[]).find((row) => !isTerminalConnectedStatus(row.status));
    if (currentService) links.push({ href: connectedRecordHref('service', currentService.id), label: `Service · ${currentService.job_number}`, kind: 'service' });
  }

  return {
    title: `${work.work_number} · ${work.title}`,
    description: 'Work-connected records: jump to the customer, machine, stock item or current machine service context.',
    links,
    signals: [`Status · ${work.status.replace(/_/g, ' ')}`],
  };
}

async function loadServiceContext(serviceId: string): Promise<WorkflowContext | null> {
  const client = getSupabaseClient();
  const result = await client.from('service_jobs').select('id, job_number, summary, status, assigned_to, customer_id, machine_id, created_at').eq('id', serviceId).single();
  if (result.error || !result.data) return null;
  const job = result.data as ServiceRow;
  const links: WorkflowLink[] = [];
  if (job.customer_id) links.push({ href: connectedRecordHref('customer', job.customer_id), label: 'Open customer', kind: 'customer' });
  if (job.machine_id) links.push({ href: connectedRecordHref('machine', job.machine_id), label: 'Open machine', kind: 'machine' });
  if (job.machine_id) {
    const workResult = await client.from('work_items').select('id, work_number, title, status, customer_id, machine_id, stock_item_id, created_at').eq('machine_id', job.machine_id).order('created_at', { ascending: false }).limit(20);
    const linkedWork = sortOpenFirst((workResult.data ?? []) as WorkRow[]).find((row) => !isTerminalConnectedStatus(row.status));
    if (linkedWork) links.push({ href: connectedRecordHref('work', linkedWork.id), label: `Work · ${linkedWork.work_number}`, kind: 'work' });
  }
  return {
    title: `${job.job_number} · ${recordLabel(job.summary, 'Service job')}`,
    description: 'Service-connected records: keep the customer, asset and operational work context one click away.',
    links,
    signals: [`Status · ${job.status.replace(/_/g, ' ')}`, job.assigned_to ? 'Technician assigned' : 'Unassigned'],
  };
}

async function loadDeliveryContext(deliveryId: string): Promise<WorkflowContext | null> {
  const client = getSupabaseClient();
  const result = await client.from('delivery_orders').select('id, order_number, customer_name, status, created_at').eq('id', deliveryId).single();
  if (result.error || !result.data) return null;
  const delivery = result.data as DeliveryRow;
  const customerResult = await client.from('customers').select('id, customer_name').eq('customer_name', delivery.customer_name).limit(1);
  const customer = ((customerResult.data ?? []) as CustomerRow[])[0];
  const links: WorkflowLink[] = customer ? [{ href: connectedRecordHref('customer', customer.id), label: `Customer · ${customer.customer_name}`, kind: 'customer' }] : [];
  return {
    title: `${delivery.order_number} · ${delivery.customer_name}`,
    description: 'Delivery-connected records: return directly to the customer relationship without navigating through module indexes.',
    links,
    signals: [`Status · ${delivery.status.replace(/_/g, ' ')}`],
  };
}

async function loadStockContext(stockId: string): Promise<WorkflowContext | null> {
  const client = getSupabaseClient();
  const stockResult = await client.from('stock_items').select('id, stock_name').eq('id', stockId).single();
  if (stockResult.error || !stockResult.data) return null;
  const stock = stockResult.data as StockRow;
  const [directWorkResult, usedPartsResult] = await Promise.all([
    client.from('work_items').select('id, work_number, title, status, customer_id, machine_id, stock_item_id, created_at').eq('stock_item_id', stockId).order('created_at', { ascending: false }).limit(30),
    client.from('work_parts_used').select('work_item_id, stock_item_id, quantity').eq('stock_item_id', stockId).order('created_at', { ascending: false }).limit(30),
  ]);
  const directWork = (directWorkResult.data ?? []) as WorkRow[];
  const usedWorkIds = Array.from(new Set(((usedPartsResult.data ?? []) as PartRow[]).map((row) => row.work_item_id)));
  let usedWork: WorkRow[] = [];
  if (usedWorkIds.length > 0) {
    const usedWorkResult = await client.from('work_items').select('id, work_number, title, status, customer_id, machine_id, stock_item_id, created_at').in('id', usedWorkIds).order('created_at', { ascending: false }).limit(30);
    usedWork = (usedWorkResult.data ?? []) as WorkRow[];
  }
  const work = sortOpenFirst([...directWork, ...usedWork].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index));
  const links = work.slice(0, 3).map((item) => ({ href: connectedRecordHref('work', item.id), label: `Work · ${item.work_number}`, kind: 'work' as const }));
  if (work[0]?.machine_id) links.push({ href: connectedRecordHref('machine', work[0].machine_id), label: 'Open related machine', kind: 'machine' });
  if (work[0]?.customer_id) links.push({ href: connectedRecordHref('customer', work[0].customer_id), label: 'Open related customer', kind: 'customer' });
  return {
    title: stock.stock_name,
    description: 'Stock-connected records: trace this item back to work, machines and customers where the relationship exists.',
    links,
    signals: [`${work.length} linked work item${work.length === 1 ? '' : 's'}`],
  };
}

async function loadWorkflowContext(kind: ConnectedRecordKind, id: string) {
  switch (kind) {
    case 'customer': return loadCustomerContext(id);
    case 'machine': return loadMachineContext(id);
    case 'work': return loadWorkContext(id);
    case 'service': return loadServiceContext(id);
    case 'delivery': return loadDeliveryContext(id);
    case 'stock': return loadStockContext(id);
  }
}

export function ConnectedWorkflowBar({ pathname, role }: { pathname: string; role: BusinessRole }) {
  const searchParams = useSearchParams();
  const requestSequence = useRef(0);
  const [context, setContext] = useState<WorkflowContext | null>(null);
  const [loading, setLoading] = useState(false);
  const search = searchParams.toString();
  const request = useMemo(() => getConnectedRecordRequest(pathname, search), [pathname, search]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    if (!request) {
      setContext(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadWorkflowContext(request.kind, request.id)
      .then((nextContext) => {
        if (sequence !== requestSequence.current) return;
        if (!nextContext) {
          setContext(null);
          return;
        }
        setContext({ ...nextContext, links: allowedLinks(role, nextContext.links) });
      })
      .catch(() => {
        if (sequence === requestSequence.current) setContext(null);
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
  }, [request, role]);

  if (!request) return null;
  if (!context && !loading) return null;

  return (
    <section aria-busy={loading} aria-label="Connected workflow" className="neo-card">
      <div className="page-toolbar-heading">
        <div>
          <div className="nav-heading">Connected workflow</div>
          <strong>{context?.title ?? 'Loading connected records…'}</strong>
          <small>{context?.description ?? 'Resolving related ERP records.'}</small>
        </div>
        {context?.signals.length ? <div className="feature-list">{context.signals.map((signal) => <span className="feature-pill" key={signal}>{signal}</span>)}</div> : null}
      </div>
      {context?.links.length ? (
        <div className="feature-list">
          {context.links.map((link) => <Link className="feature-pill" href={link.href} key={link.href}>{link.label}</Link>)}
        </div>
      ) : context && !loading ? <small>No additional connected records are available within your current access scope.</small> : null}
    </section>
  );
}
