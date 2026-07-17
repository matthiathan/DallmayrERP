import type { BusinessRole } from '@/types/dallmayrerp';

export type NavItem = {
  href: string;
  label: string;
  roles: BusinessRole[] | 'all';
  code: string;
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
    heading: 'System',
    items: [
      { href: '/workspace', label: 'Start Page', code: 'STP01', roles: 'all', description: 'Role-focused shortcuts, alerts and live counts.' },
      { href: '/', label: 'System Dashboard', code: 'SYS01', roles: ['admin'], description: 'Administrative overview and core ERP counts.' },
      { href: '/admin/users', label: 'Users & Roles', code: 'USR01', roles: ['admin'], description: 'Invite users, assign roles, branches and permissions.' },
      { href: '/admin/activity', label: 'Activity Log', code: 'AUD01', roles: ['admin'], description: 'Audit events and system activity.' },
    ],
  },
  {
    heading: 'Masters',
    items: [
      { href: '/customers', label: 'Customer Master', code: 'CM01', roles: 'all', description: 'Customer accounts, account codes, branches, sites and contacts.' },
      { href: '/operations/assets', label: 'Machine Master', code: 'MM01', roles: ['admin', 'operations', 'technician', 'road_technician'], description: 'Machine register, customer links, QR codes and serial numbers.' },
      { href: '/warehouse/stock', label: 'Stock Master', code: 'SM01', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Stock items, barcodes, photos, quantities and reorder rules.' },
      { href: '/warehouse/locations', label: 'Warehouse Locations', code: 'WL01', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Warehouses, stockrooms, shelves, bins and dispatch areas.' },
    ],
  },
  {
    heading: 'Fixed Assets',
    items: [
      { href: '/operations/assets', label: 'Fixed Asset Master List', code: 'FAMST', roles: ['admin', 'operations', 'technician', 'road_technician'], description: 'Machine and asset master records.' },
      { href: '/operations/assets/lifecycle', label: 'Asset Lifecycle', code: 'FAL01', roles: ['admin', 'operations', 'technician', 'road_technician', 'executive'], description: 'Custody, condition, audit history and lifecycle events.' },
      { href: '/operations/reliability', label: 'Asset Reliability', code: 'FAR01', roles: ['admin', 'operations', 'technician', 'road_technician', 'executive'], description: 'Meter readings, downtime and reliability evidence.' },
      { href: '/operations/maintenance', label: 'Preventive Maintenance', code: 'PM01', roles: ['admin', 'operations', 'technician', 'road_technician', 'executive'], description: 'Calendar, meter and hybrid maintenance plans.' },
    ],
  },
  {
    heading: 'Transactions',
    items: [
      { href: '/work', label: 'Action Centre', code: 'ACT01', roles: 'all', description: 'Assigned work, approvals, exceptions and operational requests.' },
      { href: '/work/execution', label: 'Work Execution', code: 'WEX01', roles: ['admin', 'operations', 'technician', 'road_technician'], description: 'Checklists, comments, parts used and controlled job closure.' },
      { href: '/operations', label: 'Operations Control', code: 'OPS01', roles: ['admin', 'operations'], description: 'Operations overview, exceptions and management controls.' },
      { href: '/operations/service-jobs', label: 'Schedules Call Log', code: 'SCL21', roles: ['admin', 'operations'], description: 'Service jobs, dispatch, priorities and technician assignment.' },
      { href: '/operations/deliveries', label: 'Delivery Board', code: 'DL01', roles: ['admin', 'operations'], description: 'Picked, dispatched, delivered and closed delivery orders.' },
      { href: '/technician', label: 'Technician Jobs', code: 'TJ01', roles: ['admin', 'technician'], description: 'Technician queue for assigned machine work.' },
      { href: '/road-tech', label: 'Road Tech Routes', code: 'RT01', roles: ['admin', 'road_technician'], description: 'Road technician routes, delivery work and field tasks.' },
      { href: '/warehouse/stock', label: 'Stock Control', code: 'SC01', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Scan, receive, issue, transfer, adjust and cycle count stock.' },
      { href: '/warehouse/purchasing', label: 'Purchase Orders', code: 'PO01', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Create purchase orders and receive stock into locations.' },
      { href: '/warehouse/purchasing/approvals', label: 'Purchase Approvals', code: 'PA01', roles: ['admin', 'operations', 'warehouse_staff', 'finance', 'executive'], description: 'Review purchase requests and approval risk.' },
    ],
  },
  {
    heading: 'Sales',
    items: [
      { href: '/sales', label: 'Sales Workspace', code: 'SAL01', roles: ['admin', 'sales'], description: 'Sales account work, pipeline and customer activity.' },
      { href: '/marketing', label: 'Marketing Dashboard', code: 'MKT01', roles: ['admin', 'marketing'], description: 'Marketing overview and campaign activity.' },
      { href: '/marketing/segments', label: 'Segments', code: 'SEG01', roles: ['admin', 'marketing'], description: 'Customer segments and target groups.' },
      { href: '/marketing/campaigns', label: 'Campaigns', code: 'CMP01', roles: ['admin', 'marketing'], description: 'Campaign planning, execution and status tracking.' },
      { href: '/marketing/contract-renewals', label: 'Contract Renewals', code: 'REN01', roles: ['admin', 'marketing'], description: 'Renewal pipeline, risk and account follow-up.' },
      { href: '/finance', label: 'Finance Workspace', code: 'FIN01', roles: ['admin', 'finance'], description: 'Finance review, commercial risk and reporting.' },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { href: '/executive/command-centre', label: 'Command Centre', code: 'CMD01', roles: ['admin', 'executive'], description: 'Executive risk summary and branch-level command view.' },
      { href: '/executive', label: 'Executive Overview', code: 'EXE01', roles: ['admin', 'executive'], description: 'High-level business and operational summary.' },
      { href: '/executive/branches', label: 'Branch Performance', code: 'BRR01', roles: ['admin', 'executive'], description: 'Compare JHB, CPT, KZN and national performance.' },
      { href: '/executive/contracts', label: 'Contract Risk', code: 'CTR01', roles: ['admin', 'executive'], description: 'Contract exposure, renewal pressure and account risk.' },
      { href: '/executive/service', label: 'Service Performance', code: 'SVR01', roles: ['admin', 'executive'], description: 'Service workload, SLA and maintenance performance.' },
      { href: '/executive/warehouse', label: 'Warehouse Risk', code: 'WHR01', roles: ['admin', 'executive'], description: 'Stock risk, low-stock exposure and inventory value.' },
    ],
  },
  {
    heading: 'Batch Reports',
    items: [
      { href: '/executive/reports', label: 'Executive Reports', code: 'BEX01', roles: ['admin', 'executive'], description: 'Saved management reports and executive reporting.' },
      { href: '/marketing/reports', label: 'Marketing Reports', code: 'BMK01', roles: ['admin', 'marketing'], description: 'Campaign, renewal and segment reporting.' },
      { href: '/warehouse/ledger', label: 'Inventory Ledger', code: 'BIL01', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Read-only movement history, references and resulting balances.' },
    ],
  },
  {
    heading: 'Utilities',
    items: [
      { href: '/warehouse/traceability', label: 'Lots & Serials', code: 'QRCD', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Lots, serials, expiry tracking and QR/barcode traceability.' },
      { href: '/operations/reliability', label: 'Meter & Downtime Capture', code: 'UTIL1', roles: ['admin', 'operations', 'technician', 'road_technician', 'executive'], description: 'Utility screen for asset meter and downtime recording.' },
      { href: '/warehouse/locations', label: 'Location Setup', code: 'UTIL2', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Warehouse, bin and stockroom setup utility.' },
      { href: '/utilities/data-matching', label: 'Data Matching Workbench', code: 'DQ01', roles: ['admin', 'operations'], description: 'Find unlinked machines, duplicate customers, duplicate barcodes and duplicate serial numbers.' },
    ],
  },
  {
    heading: 'Windows',
    items: [
      { href: '/workspace', label: 'Start Page', code: 'WIN01', roles: 'all', description: 'Return to the role workspace and open-screen overview.' },
      { href: '/work', label: 'Action Centre', code: 'WIN02', roles: 'all', description: 'Open the operational action inbox.' },
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
