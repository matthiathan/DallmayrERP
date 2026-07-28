import type { BusinessRole } from '@/types/dallmayrerp';

export type NavItem = {
  href: string;
  label: string;
  roles: BusinessRole[] | 'all';
  code: string;
  description?: string;
  navigationOnlyFor?: BusinessRole[];
};

export type NavSection = {
  heading: string;
  items: NavItem[];
};

export const roleHomePath: Record<BusinessRole, string> = {
  admin: '/workspace',
  operations: '/operations/dashboard',
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
  operations: 'Operations Manager',
  sales: 'Sales',
  finance: 'Finance',
  marketing: 'Marketing',
  executive: 'Executive',
  warehouse_staff: 'Warehouse Staff',
  technician: 'Technician',
  road_technician: 'Road Technician',
};

const operationsNavigationOnly: BusinessRole[] = ['operations'];

export const navSections: NavSection[] = [
  {
    heading: 'Operations',
    items: [
      { href: '/operations/dashboard', label: 'Operations Start Page', code: 'OPH01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Live branch workload, route pressure, service exceptions and daily priorities.' },
      { href: '/operations/dispatch', label: 'Dispatch Overview', code: 'DSP01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Combined route gaps, service exceptions, delivery pressure and technician capacity.' },
      { href: '/operations/service-planning', label: 'Daily Service Planner', code: 'SRP01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Plan clients, drivers, route numbers, stop order and reschedules.' },
      { href: '/operations/service-jobs', label: 'Scheduled Call Log', code: 'SCL21', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Create request-only service work and assign technicians.' },
      { href: '/operations/deliveries', label: 'Delivery Board', code: 'DL01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Control picked, dispatched, delivered and closed delivery orders.' },
      { href: '/work', label: 'Operations Action Centre', code: 'ACT01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Review approvals, exceptions, unassigned work and escalations.' },
      { href: '/work/execution', label: 'Work Execution Review', code: 'WEX01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Review checklists, evidence, parts used and controlled closure.' },
    ],
  },
  {
    heading: 'Assets & Maintenance',
    items: [
      { href: '/customers', label: 'Customer Master', code: 'CM01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Customer accounts, sites, contacts, addresses and branch ownership.' },
      { href: '/operations/assets', label: 'Machine Master', code: 'MM01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Machine register, customer links, QR codes and serial numbers.' },
      { href: '/operations/assets/lifecycle', label: 'Asset Lifecycle', code: 'FAL01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Custody, condition, audit history and lifecycle events.' },
      { href: '/operations/reliability', label: 'Asset Reliability', code: 'FAR01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Meter readings, downtime, restoration and reliability evidence.' },
      { href: '/operations/maintenance', label: 'Preventive Maintenance', code: 'PM01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Calendar, meter and hybrid maintenance planning.' },
      { href: '/utilities/data-matching', label: 'Data Matching Workbench', code: 'DQ01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Resolve unlinked machines, duplicate customers, barcodes and serials.' },
    ],
  },
  {
    heading: 'Inventory',
    items: [
      { href: '/warehouse/stock', label: 'Stock Control', code: 'SC01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Review stock, scans, issues, transfers, adjustments and counts.' },
      { href: '/warehouse/planning', label: 'Inventory Planning', code: 'IP01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Stock-out risk, recommended orders and branch redistribution.' },
      { href: '/warehouse/purchasing', label: 'Purchase Orders', code: 'PO01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Create purchase orders and monitor receiving.' },
      { href: '/warehouse/purchasing/approvals', label: 'Purchase Approvals', code: 'PA01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Review purchase requests and operational approval risk.' },
      { href: '/warehouse/locations', label: 'Warehouse Locations', code: 'WL01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Warehouses, stockrooms, shelves, bins and dispatch areas.' },
      { href: '/warehouse/traceability', label: 'Lots & Serials', code: 'QRCD', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Lot, serial, expiry and barcode traceability.' },
      { href: '/warehouse/ledger', label: 'Inventory Ledger', code: 'BIL01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Read-only stock movement and balance history.' },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { href: '/operations/reports', label: 'Operations Performance', code: 'OPR01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Service, route, delivery and workload performance by date and branch.' },
      { href: '/operations/maintenance', label: 'Maintenance Due', code: 'OPR02', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Forward-looking preventive maintenance pressure.' },
      { href: '/warehouse/planning', label: 'Inventory Exceptions', code: 'OPR03', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Low stock, excess stock and redistribution exceptions.' },
    ],
  },
  {
    heading: 'Windows',
    items: [
      { href: '/operations/dashboard', label: 'Operations Start Page', code: 'WIN01', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Return to the Operations Manager home page.' },
      { href: '/work', label: 'Action Centre', code: 'WIN02', roles: ['operations'], navigationOnlyFor: operationsNavigationOnly, description: 'Open the Operations action and exception inbox.' },
    ],
  },
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
      { href: '/operations/dispatch', label: 'Dispatch Overview', code: 'DSP01', roles: ['admin', 'operations'], description: 'Unified route, service, delivery and technician workload pressure.' },
      { href: '/operations/service-planning', label: 'Service Route Planner', code: 'SRP01', roles: ['admin', 'operations'], description: 'Plan daily driver routes from paid monthly obligations and requested service work.' },
      { href: '/operations/service-jobs', label: 'Scheduled Call Log', code: 'SCL21', roles: ['admin', 'operations'], description: 'Create requested service jobs, dispatch priorities and technician assignments.' },
      { href: '/operations/deliveries', label: 'Delivery Board', code: 'DL01', roles: ['admin', 'operations'], description: 'Picked, dispatched, delivered and closed delivery orders.' },
      { href: '/technician', label: 'Technician Jobs', code: 'TJ01', roles: ['admin', 'technician'], description: 'Technician queue for assigned machine work.' },
      { href: '/road-tech', label: 'Road Tech Routes', code: 'RT01', roles: ['admin', 'road_technician'], description: 'Road technician routes, delivery work and field tasks.' },
      { href: '/warehouse/stock', label: 'Stock Control', code: 'SC01', roles: ['admin', 'operations', 'warehouse_staff'], description: 'Scan, receive, issue, transfer, adjust and cycle count stock.' },
      { href: '/warehouse/planning', label: 'Inventory Planning', code: 'IP01', roles: ['admin', 'operations', 'warehouse_staff', 'executive'], description: 'Stock-out risk, recommended orders, excess stock and branch redistribution.' },
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
      { href: '/finance/service-coverage', label: 'Monthly Service Coverage', code: 'FSC01', roles: ['admin', 'finance'], description: 'Confirm monthly service payments and report paid customers who were not serviced.' },
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
      { href: '/warehouse/planning', label: 'Inventory Planning', code: 'IPR01', roles: ['admin', 'operations', 'warehouse_staff', 'executive'], description: 'Exception-based replenishment and redistribution report.' },
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
  if (item.navigationOnlyFor) return item.navigationOnlyFor.includes(role);
  if (role === 'operations') return false;
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
