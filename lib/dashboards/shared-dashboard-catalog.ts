import type { Branch, BusinessRole } from '@/types/dallmayrerp';

export type SharedDashboardMetricKey =
  | 'branch_open_work'
  | 'branch_overdue_work'
  | 'pending_approvals'
  | 'business_users'
  | 'unassigned_work'
  | 'open_service_jobs'
  | 'stock_alerts'
  | 'open_purchase_orders'
  | 'open_deliveries'
  | 'my_active_work'
  | 'my_overdue_work'
  | 'my_open_service_jobs'
  | 'my_high_priority_work'
  | 'my_open_deliveries'
  | 'customer_count'
  | 'contract_records'
  | 'open_opportunities'
  | 'commercial_accounts'
  | 'pending_purchase_approvals'
  | 'pending_work_approvals'
  | 'active_campaigns'
  | 'marketing_segments'
  | 'renewals_due_90';

export type SharedDashboardSummary = Record<SharedDashboardMetricKey, number> & {
  user_id: string;
  role: BusinessRole;
  branch: string;
};

export type SharedDashboardWidgetRecord = {
  id: string;
  dashboard_id: string;
  metric_key: SharedDashboardMetricKey;
  position: number;
  created_at: string;
  updated_at: string;
};

export type SharedDashboardRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  target_role: BusinessRole;
  branch_scope: Branch | null;
  is_published: boolean;
  published_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  shared_dashboard_widgets?: SharedDashboardWidgetRecord[] | null;
};

export type SharedDashboardMetricDefinition = {
  key: SharedDashboardMetricKey;
  label: string;
  helper: string;
  drilldown?: string;
};

export const sharedDashboardRoleOptions: BusinessRole[] = [
  'admin',
  'operations',
  'sales',
  'finance',
  'marketing',
  'executive',
  'warehouse_staff',
  'technician',
  'road_technician',
];

export const sharedDashboardBranchOptions: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

const catalog: Record<BusinessRole, SharedDashboardMetricDefinition[]> = {
  admin: [
    { key: 'branch_open_work', label: 'Open work', helper: 'All active work items nationally.', drilldown: '/work' },
    { key: 'branch_overdue_work', label: 'Overdue work', helper: 'Open work beyond its due or SLA date.', drilldown: '/work' },
    { key: 'pending_approvals', label: 'Pending approvals', helper: 'Work and purchase approvals awaiting action.', drilldown: '/work' },
    { key: 'business_users', label: 'Business users', helper: 'ERP user records currently configured.', drilldown: '/admin/users' },
  ],
  operations: [
    { key: 'branch_open_work', label: 'Open branch work', helper: 'Active work in your assigned branch scope.', drilldown: '/work' },
    { key: 'branch_overdue_work', label: 'Overdue branch work', helper: 'Branch work beyond its due or SLA date.', drilldown: '/work' },
    { key: 'unassigned_work', label: 'Unassigned work', helper: 'Open work still requiring an owner.', drilldown: '/work' },
    { key: 'open_service_jobs', label: 'Open service jobs', helper: 'Service jobs still requiring completion.', drilldown: '/operations/service-jobs' },
  ],
  warehouse_staff: [
    { key: 'stock_alerts', label: 'Stock alerts', helper: 'Open or acknowledged inventory alerts.', drilldown: '/warehouse/stock' },
    { key: 'open_purchase_orders', label: 'Open purchase orders', helper: 'Orders not yet received or closed.', drilldown: '/warehouse/purchasing' },
    { key: 'open_deliveries', label: 'Open deliveries', helper: 'Delivery orders not yet closed.' },
    { key: 'my_active_work', label: 'My active work', helper: 'Open work assigned directly to you.', drilldown: '/work' },
  ],
  technician: [
    { key: 'my_active_work', label: 'My active work', helper: 'Open work assigned directly to you.', drilldown: '/work' },
    { key: 'my_overdue_work', label: 'My overdue work', helper: 'Your assigned work beyond its due or SLA date.', drilldown: '/work' },
    { key: 'my_open_service_jobs', label: 'My service jobs', helper: 'Open service jobs assigned directly to you.', drilldown: '/technician' },
    { key: 'my_high_priority_work', label: 'High-priority work', helper: 'Your active high or critical priority work.', drilldown: '/work' },
  ],
  road_technician: [
    { key: 'my_active_work', label: 'My active work', helper: 'Open work assigned directly to you.', drilldown: '/work' },
    { key: 'my_overdue_work', label: 'My overdue work', helper: 'Your assigned work beyond its due or SLA date.', drilldown: '/work' },
    { key: 'my_open_deliveries', label: 'My deliveries', helper: 'Open delivery orders assigned directly to you.', drilldown: '/road-tech' },
    { key: 'my_open_service_jobs', label: 'My service jobs', helper: 'Open service jobs assigned directly to you.', drilldown: '/road-tech' },
  ],
  executive: [
    { key: 'branch_open_work', label: 'Open work', helper: 'All active operational work nationally.', drilldown: '/work' },
    { key: 'branch_overdue_work', label: 'Overdue work', helper: 'Open work beyond its due or SLA date.', drilldown: '/work' },
    { key: 'pending_approvals', label: 'Pending approvals', helper: 'Work and purchase approvals awaiting action.', drilldown: '/work' },
    { key: 'stock_alerts', label: 'Stock alerts', helper: 'Open or acknowledged inventory alerts.', drilldown: '/warehouse/stock' },
  ],
  sales: [
    { key: 'customer_count', label: 'Customers', helper: 'Customer records in your branch scope.', drilldown: '/customers' },
    { key: 'contract_records', label: 'Contract records', helper: 'Imported contract-renewal records in scope.' },
    { key: 'open_opportunities', label: 'Open opportunities', helper: 'Open, follow-up or quoted opportunities.', drilldown: '/sales' },
    { key: 'my_active_work', label: 'My open work', helper: 'Open requests or tasks assigned to you.', drilldown: '/work' },
  ],
  finance: [
    { key: 'commercial_accounts', label: 'Commercial accounts', helper: 'Commercial customer records in your branch scope.', drilldown: '/finance' },
    { key: 'pending_purchase_approvals', label: 'Purchase approvals', helper: 'Purchase orders awaiting approval.', drilldown: '/warehouse/purchasing/approvals' },
    { key: 'pending_work_approvals', label: 'Work approvals', helper: 'Work items awaiting approval.', drilldown: '/work' },
    { key: 'my_active_work', label: 'My active work', helper: 'Open work assigned directly to you.', drilldown: '/work' },
  ],
  marketing: [
    { key: 'active_campaigns', label: 'Active campaigns', helper: 'Campaigns not completed, closed or cancelled.', drilldown: '/marketing/campaigns' },
    { key: 'marketing_segments', label: 'Segments', helper: 'Saved marketing audience segments.', drilldown: '/marketing/segments' },
    { key: 'renewals_due_90', label: 'Renewals due', helper: 'Contract records expired or due within 90 days.', drilldown: '/marketing/contract-renewals' },
    { key: 'customer_count', label: 'Customers', helper: 'Customer records in your branch scope.', drilldown: '/customers' },
  ],
};

export function sharedDashboardMetricsForRole(role: BusinessRole) {
  return catalog[role];
}

export function sharedDashboardMetricForRole(role: BusinessRole, key: string) {
  return catalog[role].find((metric) => metric.key === key) ?? null;
}

export function sharedDashboardRoleAllowsMetric(role: BusinessRole, key: string) {
  return Boolean(sharedDashboardMetricForRole(role, key));
}

export function sharedDashboardBranchLabel(branch: Branch | null | undefined) {
  if (!branch) return 'All branches';
  if (branch === 'jhb') return 'Johannesburg';
  if (branch === 'cpt') return 'Cape Town';
  if (branch === 'kzn') return 'KwaZulu-Natal';
  return 'National';
}

export function sharedDashboardSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
