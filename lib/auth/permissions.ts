import type { BusinessRole } from '@/types/dallmayrerp';

export type NavItem = {
  href: string;
  label: string;
  roles: BusinessRole[] | 'all';
  description?: string;
};

export type NavSection = {
  heading: string;
  items: NavItem[];
};

export const roleHomePath: Record<BusinessRole, string> = {
  admin: '/workspace',
  operations: '/workspace',
  sales: '/workspace',
  finance: '/workspace',
  marketing: '/workspace',
  executive: '/workspace',
  warehouse_staff: '/workspace',
  technician: '/workspace',
  road_technician: '/workspace',
};

export const roleLabels: Record<BusinessRole, string> = {
  admin: 'Administrator',
  operations: 'Operations',
  sales: 'Sales',
  finance: 'Finance',
  marketing: 'Marketing',
  executive: 'Executive',
  warehouse_staff: 'Warehouse Staff',
  technician: 'Technician',
  road_technician: 'Road Technician',
};

export const navSections: NavSection[] = [
  {
    heading: 'Workspace',
    items: [
      { href: '/workspace', label: 'My Workspace', roles: 'all', description: 'Role-focused daily shortcuts, alerts and live counts.' },
    ],
  },
  {
    heading: 'Work',
    items: [
      { href: '/work', label: 'Action Centre', roles: 'all', description: 'Assigned work, approvals, exceptions and operational requests.' },
      { href: '/work/execution', label: 'Work Execution', roles: ['admin', 'operations', 'technician', 'road_technician'], description: 'Checklists, comments, parts used and controlled job closure.' },
      { href: '/operations', label: 'Operations Control', roles: ['admin', 'operations'], description: 'Operations overview, exceptions and management controls.' },
      { href: '/operations/service-jobs', label: 'Service Jobs', roles: ['admin', 'operations'], description: 'Dispatch service work, assign technicians and manage statuses.' },
      { href: '/technician', label: 'Technician Jobs', roles: ['admin', 'technician'], description: 'Technician queue for assigned machine work.' },
      { href: '/road-tech', label: 'Road Tech Routes', roles: ['admin', 'road_technician'], description: 'Road technician routes, delivery work and field tasks.' },
      { href: '/operations/deliveries', label: 'Delivery Board', roles: ['admin', 'operations'], description: 'Track picked, dispatched, delivered and closed orders.' },
    ],
  },
  {
    heading: 'Stock',
    items: [
      { href: '/warehouse/stock', label: 'Stock Control', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Scan, receive, issue, transfer, adjust and cycle count stock.' },
      { href: '/warehouse/purchasing', label: 'Purchase Orders', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Create purchase orders and receive stock into locations.' },
      { href: '/warehouse/purchasing/approvals', label: 'Purchase Approvals', roles: ['admin', 'operations', 'warehouse_staff', 'finance', 'executive'], description: 'Review purchase requests and approval risk.' },
      { href: '/warehouse/traceability', label: 'Lots & Serials', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Track stock lots, serials, expiry and traceability records.' },
      { href: '/warehouse/locations', label: 'Warehouses & Locations', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Maintain warehouses, stockrooms, shelves and bins.' },
      { href: '/warehouse/ledger', label: 'Inventory Ledger', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Read-only movement history, references and resulting balances.' },
    ],
  },
  {
    heading: 'Assets',
    items: [
      { href: '/operations/assets', label: 'Machine Assets', roles: ['admin', 'operations', 'technician', 'road_technician'], description: 'Machine register, customer links, QR codes and serial numbers.' },
      { href: '/operations/assets/lifecycle', label: 'Asset Lifecycle', roles: ['admin', 'operations', 'technician', 'road_technician', 'executive'], description: 'Custody, condition, audit history and lifecycle events.' },
      { href: '/operations/reliability', label: 'Asset Reliability', roles: ['admin', 'operations', 'technician', 'road_technician', 'executive'], description: 'Meter readings, downtime and reliability evidence.' },
      { href: '/operations/maintenance', label: 'Preventive Maintenance', roles: ['admin', 'operations', 'technician', 'road_technician', 'executive'], description: 'Calendar, meter and hybrid maintenance plans.' },
    ],
  },
  {
    heading: 'Customers',
    items: [
      { href: '/customers', label: 'Customer Directory', roles: 'all', description: 'Search customers, account codes, branches, contact details and sites.' },
    ],
  },
  {
    heading: 'Admin Control',
    items: [
      { href: '/', label: 'System Dashboard', roles: ['admin'], description: 'Administrative overview and core ERP counts.' },
      { href: '/admin/users', label: 'Users & Roles', roles: ['admin'], description: 'Invite users, assign roles, branches and access permissions.' },
      { href: '/admin/activity', label: 'Activity Log', roles: ['admin'], description: 'Review audit events and system activity.' },
    ],
  },
  {
    heading: 'Commercial',
    items: [
      { href: '/sales', label: 'Sales Workspace', roles: ['admin', 'sales'], description: 'Sales account work, pipeline and customer activity.' },
      { href: '/finance', label: 'Finance Workspace', roles: ['admin', 'finance'], description: 'Finance review, commercial risk and reporting.' },
    ],
  },
  {
    heading: 'Marketing',
    items: [
      { href: '/marketing', label: 'Marketing Dashboard', roles: ['admin', 'marketing'], description: 'Marketing overview and campaign activity.' },
      { href: '/marketing/segments', label: 'Segments', roles: ['admin', 'marketing'], description: 'Customer segments and target groups.' },
      { href: '/marketing/campaigns', label: 'Campaigns', roles: ['admin', 'marketing'], description: 'Campaign planning, execution and status tracking.' },
      { href: '/marketing/contract-renewals', label: 'Contract Renewals', roles: ['admin', 'marketing'], description: 'Renewal pipeline, risk and account follow-up.' },
      { href: '/marketing/reports', label: 'Marketing Reports', roles: ['admin', 'marketing'], description: 'Campaign, renewal and segment reporting.' },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { href: '/executive/command-centre', label: 'Command Centre', roles: ['admin', 'executive'], description: 'Executive risk summary and branch-level command view.' },
      { href: '/executive', label: 'Executive Overview', roles: ['admin', 'executive'], description: 'High-level business and operational summary.' },
      { href: '/executive/branches', label: 'Branch Performance', roles: ['admin', 'executive'], description: 'Compare JHB, CPT, KZN and national performance.' },
      { href: '/executive/contracts', label: 'Contract Risk', roles: ['admin', 'executive'], description: 'Contract exposure, renewal pressure and account risk.' },
      { href: '/executive/service', label: 'Service Performance', roles: ['admin', 'executive'], description: 'Service workload, SLA and maintenance performance.' },
      { href: '/executive/warehouse', label: 'Warehouse Risk', roles: ['admin', 'executive'], description: 'Stock risk, low-stock exposure and inventory value.' },
      { href: '/executive/reports', label: 'Executive Reports', roles: ['admin', 'executive'], description: 'Saved management reports and executive reporting.' },
    ],
  },
];

export function isNavItemAllowed(role: BusinessRole, item: NavItem) {
  return item.roles === 'all' || item.roles.includes(role) || role === 'admin';
}

export function canAccessPath(role: BusinessRole, pathname: string) {
  if (pathname === '/login' || pathname === '/onboarding') return true;
  if (role === 'admin') return true;
  if (pathname === '/') return false;

  return navSections.some((section) =>
    section.items.some((item) => {
      if (!isNavItemAllowed(role, item)) return false;
      return pathname === item.href || pathname.startsWith(`${item.href}/`);
    }),
  );
}

export function getDefaultPathForRole(role: BusinessRole) {
  return roleHomePath[role] ?? '/login';
}
