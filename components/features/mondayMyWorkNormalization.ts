import type { Branch } from '@/types/dallmayrerp';
import type { WorkItemRecord } from '@/types/professional-ops';

type ServiceQueueInput = {
  id: string;
  job_number: string;
  summary: string;
  customer_name_snapshot: string | null;
  branch: Branch;
  priority: string;
  status: string;
  due_at: string | null;
  assigned_to: string | null;
};

type DeliveryQueueInput = {
  id: string;
  order_number: string;
  customer_name: string;
  branch: Branch;
  status: string;
  created_at: string;
  assigned_to: string | null;
};

type PurchaseQueueInput = {
  id: string;
  po_number: string;
  supplier_name: string;
  branch: Branch;
  status: string;
  expected_date: string | null;
  approval_status: string;
};

type StockRelation = { stock_name: string | null };
type StockAlertQueueInput = {
  id: string;
  alert_type: string;
  status: string;
  current_quantity: number;
  threshold: number;
  stock_items?: StockRelation | StockRelation[] | null;
};

type AssetAuditQueueInput = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  branch: Branch;
  condition: string;
  criticality: string;
  next_audit_at: string | null;
};

type WorkSource = 'work' | 'service' | 'delivery' | 'purchase' | 'stock' | 'asset';

type NormalizedMyWorkItem = {
  id: string;
  source: WorkSource;
  sourceLabel: string;
  title: string;
  subtitle: string;
  description: string;
  status: string;
  priority: string;
  branch: string;
  dueAt: string | null;
  href: string;
  isOpen: boolean;
  isMine: boolean;
  isUnassigned: boolean;
  approvalPending: boolean;
};

const terminalStatuses = new Set(['completed', 'closed', 'cancelled', 'received', 'resolved', 'verified', 'rejected']);

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isOpenStatus(status: string) {
  return !terminalStatuses.has(status);
}

export function isPast(value: string | null) {
  return Boolean(value && new Date(value).getTime() < Date.now());
}

export function normalizeMyWorkItems({
  assetAudits,
  currentUserId,
  deliveries,
  purchaseOrders,
  serviceJobs,
  sourceLabels,
  stockAlerts,
  stockBranch,
  workItems,
}: {
  assetAudits: AssetAuditQueueInput[];
  currentUserId: string;
  deliveries: DeliveryQueueInput[];
  purchaseOrders: PurchaseQueueInput[];
  serviceJobs: ServiceQueueInput[];
  sourceLabels: Record<WorkSource, string>;
  stockAlerts: StockAlertQueueInput[];
  stockBranch: Branch;
  workItems: WorkItemRecord[];
}): NormalizedMyWorkItem[] {
  return [
    ...workItems.map((item): NormalizedMyWorkItem => ({
      id: `work:${item.id}`,
      source: 'work',
      sourceLabel: sourceLabels.work,
      title: item.title,
      subtitle: item.work_number,
      description: item.description || `${item.work_type.replace(/_/g, ' ')} · ${item.department}`,
      status: item.status,
      priority: item.priority,
      branch: item.branch,
      dueAt: item.due_at ?? item.sla_due_at,
      href: `/work/${item.id}`,
      isOpen: isOpenStatus(item.status),
      isMine: item.assigned_to === currentUserId || item.requested_by === currentUserId,
      isUnassigned: isOpenStatus(item.status) && !item.assigned_to,
      approvalPending: item.approval_status === 'pending',
    })),
    ...serviceJobs.map((job): NormalizedMyWorkItem => ({
      id: `service:${job.id}`,
      source: 'service',
      sourceLabel: sourceLabels.service,
      title: job.summary || job.job_number,
      subtitle: `${job.job_number}${job.customer_name_snapshot ? ` · ${job.customer_name_snapshot}` : ''}`,
      description: job.customer_name_snapshot || 'Customer service work',
      status: job.status,
      priority: job.priority,
      branch: job.branch,
      dueAt: job.due_at,
      href: `/operations/service-jobs?job=${encodeURIComponent(job.id)}`,
      isOpen: isOpenStatus(job.status),
      isMine: job.assigned_to === currentUserId,
      isUnassigned: isOpenStatus(job.status) && !job.assigned_to,
      approvalPending: false,
    })),
    ...deliveries.map((delivery): NormalizedMyWorkItem => ({
      id: `delivery:${delivery.id}`,
      source: 'delivery',
      sourceLabel: sourceLabels.delivery,
      title: delivery.customer_name,
      subtitle: delivery.order_number,
      description: `Delivery order ${delivery.order_number}`,
      status: delivery.status,
      priority: delivery.status === 'dispatched' ? 'high' : 'medium',
      branch: delivery.branch,
      dueAt: null,
      href: `/operations/deliveries?order=${encodeURIComponent(delivery.id)}`,
      isOpen: isOpenStatus(delivery.status),
      isMine: delivery.assigned_to === currentUserId,
      isUnassigned: isOpenStatus(delivery.status) && !delivery.assigned_to,
      approvalPending: false,
    })),
    ...purchaseOrders.map((order): NormalizedMyWorkItem => ({
      id: `purchase:${order.id}`,
      source: 'purchase',
      sourceLabel: sourceLabels.purchase,
      title: order.supplier_name,
      subtitle: order.po_number,
      description: `Purchase order ${order.po_number}`,
      status: order.approval_status === 'pending' ? 'pending approval' : order.status,
      priority: order.approval_status === 'pending' ? 'high' : 'medium',
      branch: order.branch,
      dueAt: order.expected_date,
      href: order.approval_status === 'pending' ? '/warehouse/purchasing/approvals' : '/warehouse/purchasing',
      isOpen: isOpenStatus(order.status),
      isMine: false,
      isUnassigned: false,
      approvalPending: order.approval_status === 'pending',
    })),
    ...stockAlerts.map((alert): NormalizedMyWorkItem => {
      const stock = firstRelation(alert.stock_items);
      return {
        id: `stock:${alert.id}`,
        source: 'stock',
        sourceLabel: sourceLabels.stock,
        title: stock?.stock_name || 'Stock item',
        subtitle: alert.alert_type.replace(/_/g, ' '),
        description: `${alert.current_quantity.toLocaleString()} available · threshold ${alert.threshold.toLocaleString()}`,
        status: alert.status,
        priority: alert.current_quantity <= 0 ? 'critical' : 'high',
        branch: stockBranch,
        dueAt: null,
        href: '/warehouse/planning',
        isOpen: isOpenStatus(alert.status),
        isMine: false,
        isUnassigned: false,
        approvalPending: false,
      };
    }),
    ...assetAudits.map((asset): NormalizedMyWorkItem => ({
      id: `asset:${asset.id}`,
      source: 'asset',
      sourceLabel: sourceLabels.asset,
      title: asset.machine_name || asset.serial_number || 'Machine',
      subtitle: asset.serial_number || 'Asset audit',
      description: `${asset.condition} condition · ${asset.criticality} criticality`,
      status: isPast(asset.next_audit_at) ? 'overdue' : 'scheduled',
      priority: asset.criticality,
      branch: asset.branch,
      dueAt: asset.next_audit_at,
      href: '/operations/assets/lifecycle',
      isOpen: true,
      isMine: false,
      isUnassigned: false,
      approvalPending: false,
    })),
  ];
}
