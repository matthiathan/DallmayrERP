'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { BusinessRole } from '@/types/dallmayrerp';

type WorkRow = { id: string; status: string; due_at: string | null; assigned_to: string | null; approval_status: string | null };
type CountState = {
  myWork: number;
  overdueWork: number;
  approvals: number;
  stockAlerts: number;
  openDeliveries: number;
  openPurchaseOrders: number;
};

type WorkspaceAction = {
  href: string;
  label: string;
  helper: string;
  badge?: keyof CountState;
};

const roleActions: Record<BusinessRole, WorkspaceAction[]> = {
  admin: [
    { href: '/work', label: 'Open Action Centre', helper: 'Tasks, approvals and exceptions.', badge: 'approvals' },
    { href: '/warehouse/stock', label: 'Manage stock', helper: 'Scan, receive, issue and transfer stock.', badge: 'stockAlerts' },
    { href: '/operations/maintenance', label: 'Generate maintenance', helper: 'Review due calendar and meter plans.', badge: 'overdueWork' },
    { href: '/admin/users', label: 'Manage users', helper: 'Roles, branches and access.' },
  ],
  operations: [
    { href: '/work', label: 'Review work queue', helper: 'Assign, approve and unblock work.', badge: 'overdueWork' },
    { href: '/operations/service-jobs', label: 'Service dispatch', helper: 'Manage jobs, priorities and technicians.' },
    { href: '/operations/deliveries', label: 'Delivery exceptions', helper: 'Track open delivery orders.', badge: 'openDeliveries' },
    { href: '/operations/maintenance', label: 'Preventive maintenance', helper: 'Generate due maintenance work.' },
  ],
  warehouse_staff: [
    { href: '/warehouse/stock', label: 'Scan stock', helper: 'Receive, issue, adjust, count or transfer.', badge: 'stockAlerts' },
    { href: '/warehouse/purchasing', label: 'Receive purchase orders', helper: 'Receive partially or fully into locations.', badge: 'openPurchaseOrders' },
    { href: '/warehouse/locations', label: 'Manage locations', helper: 'Bins, shelves, stockrooms and dispatch areas.' },
    { href: '/warehouse/ledger', label: 'View ledger', helper: 'Read-only movement and balance history.' },
  ],
  technician: [
    { href: '/technician', label: 'My technician jobs', helper: 'Open assigned machine work.', badge: 'myWork' },
    { href: '/work/execution', label: 'Execute work', helper: 'Checklist, comments and parts used.', badge: 'myWork' },
    { href: '/operations/reliability', label: 'Record meter or downtime', helper: 'Capture usage and restoration evidence.' },
    { href: '/operations/assets', label: 'Find machine', helper: 'Search QR, serial or customer machine.' },
  ],
  road_technician: [
    { href: '/road-tech', label: 'Road tech routes', helper: 'Open route and delivery work.', badge: 'openDeliveries' },
    { href: '/work/execution', label: 'Execute work', helper: 'Complete tasks, comments and parts used.', badge: 'myWork' },
    { href: '/operations/reliability', label: 'Record reliability', helper: 'Meter readings and downtime.' },
    { href: '/operations/assets', label: 'Find machine', helper: 'Search QR, serial or machine.' },
  ],
  executive: [
    { href: '/executive/command-centre', label: 'Command centre', helper: 'Branch risk and operational performance.' },
    { href: '/executive/service', label: 'Service performance', helper: 'SLA, downtime and reliability.' },
    { href: '/executive/warehouse', label: 'Warehouse risk', helper: 'Stock alerts and inventory exposure.', badge: 'stockAlerts' },
    { href: '/operations/maintenance', label: 'Maintenance due', helper: 'Forward-looking maintenance load.' },
  ],
  sales: [
    { href: '/customers', label: 'Customer directory', helper: 'Search account, branch, phone or address.' },
    { href: '/sales', label: 'Sales workspace', helper: 'Sales pipeline and account work.' },
    { href: '/work', label: 'My requests', helper: 'Track requested tasks and approvals.', badge: 'myWork' },
  ],
  finance: [
    { href: '/finance', label: 'Finance workspace', helper: 'Financial operations and reports.' },
    { href: '/warehouse/purchasing/approvals', label: 'Purchase approvals', helper: 'Review purchase risk and approvals.', badge: 'approvals' },
    { href: '/work', label: 'Approval queue', helper: 'Finance requests and decisions.', badge: 'approvals' },
  ],
  marketing: [
    { href: '/marketing', label: 'Marketing dashboard', helper: 'Campaign and segment activity.' },
    { href: '/marketing/contract-renewals', label: 'Contract renewals', helper: 'Renewal pipeline and customer exposure.' },
    { href: '/customers', label: 'Customer directory', helper: 'Find accounts and branches.' },
  ],
};

function isOpen(status: string) {
  return !['completed', 'closed', 'cancelled', 'received', 'resolved'].includes(status);
}

function isPast(value: string | null) {
  return Boolean(value && new Date(value).getTime() < Date.now());
}

async function safeLoad<T>(loader: () => Promise<T>, fallback: T) {
  try {
    return await loader();
  } catch {
    return fallback;
  }
}

export function RoleWorkspacePanel() {
  const { businessUser, userDetails } = useAuth();
  const [counts, setCounts] = useState<CountState>({ myWork: 0, overdueWork: 0, approvals: 0, stockAlerts: 0, openDeliveries: 0, openPurchaseOrders: 0 });
  const role = userDetails?.role;

  useEffect(() => {
    async function loadCounts() {
      const client = getSupabaseClient();
      const [workItems, stockAlerts, deliveries, purchaseOrders] = await Promise.all([
        safeLoad(async () => {
          const { data, error } = await client.from('work_items').select('id, status, due_at, assigned_to, approval_status').limit(1000);
          if (error) throw error;
          return (data ?? []) as WorkRow[];
        }, [] as WorkRow[]),
        safeLoad(async () => {
          const { data, error } = await client.from('stock_alerts').select('id, status').in('status', ['open', 'acknowledged']).limit(500);
          if (error) throw error;
          return data?.length ?? 0;
        }, 0),
        safeLoad(async () => {
          const { data, error } = await client.from('delivery_orders').select('id, status').limit(500);
          if (error) throw error;
          return (data ?? []).filter((item) => isOpen(String(item.status))).length;
        }, 0),
        safeLoad(async () => {
          const { data, error } = await client.from('purchase_orders').select('id, status').limit(500);
          if (error) throw error;
          return (data ?? []).filter((item) => isOpen(String(item.status))).length;
        }, 0),
      ]);

      setCounts({
        myWork: workItems.filter((item) => item.assigned_to === businessUser?.id && isOpen(item.status)).length,
        overdueWork: workItems.filter((item) => isOpen(item.status) && isPast(item.due_at)).length,
        approvals: workItems.filter((item) => item.approval_status === 'pending').length,
        stockAlerts,
        openDeliveries: deliveries,
        openPurchaseOrders: purchaseOrders,
      });
    }

    loadCounts();
  }, [businessUser?.id]);

  const actions = useMemo(() => (role ? roleActions[role] : []), [role]);

  if (!role) {
    return <EmptyState title="Workspace unavailable" message="Your role is still loading. Refresh the page if this does not update." />;
  }

  return (
    <div className="role-workspace-stage">
      <div className="minimal-metric-grid">
        <div className="minimal-metric"><span>My active work</span><strong>{counts.myWork}</strong></div>
        <div className="minimal-metric"><span>Overdue work</span><strong>{counts.overdueWork}</strong></div>
        <div className="minimal-metric"><span>Approvals</span><strong>{counts.approvals}</strong></div>
        <div className="minimal-metric"><span>Stock alerts</span><strong>{counts.stockAlerts}</strong></div>
      </div>

      <section className="minimal-panel">
        <div className="minimal-panel-header">
          <div>
            <span className="minimal-kicker">Daily shortcuts</span>
            <h2>{role.replace(/_/g, ' ')} workspace</h2>
            <p>Open the tasks and operational screens most relevant to your role.</p>
          </div>
        </div>
        <div className="role-action-grid">
          {actions.map((action) => (
            <Link className="role-action-card" href={action.href} key={action.href}>
              <div>
                <h3>{action.label}</h3>
                <p>{action.helper}</p>
              </div>
              {action.badge ? <StatusBadge value={counts[action.badge] > 0 ? 'warning' : 'active'} label={String(counts[action.badge])} /> : null}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
