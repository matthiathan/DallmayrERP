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
  admin: '/',
  operations: '/operations',
  sales: '/sales',
  finance: '/finance',
  marketing: '/marketing',
  executive: '/executive',
  warehouse_staff: '/warehouse/stock',
  technician: '/technician',
  road_technician: '/road-tech',
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
    heading: 'Admin Control',
    items: [
      { href: '/', label: 'System Dashboard', roles: ['admin'] },
      { href: '/admin/users', label: 'Users & Roles', roles: ['admin'] },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { href: '/operations', label: 'Operations Control', roles: ['admin', 'operations'] },
      { href: '/warehouse/stock', label: 'Warehouse Stock', roles: ['admin', 'warehouse_staff'] },
      { href: '/technician', label: 'Technician Jobs', roles: ['admin', 'technician'] },
      { href: '/road-tech', label: 'Road Tech Routes', roles: ['admin', 'road_technician'] },
    ],
  },
  {
    heading: 'Commercial',
    items: [
      { href: '/sales', label: 'Sales Workspace', roles: ['admin', 'sales'] },
      { href: '/finance', label: 'Finance Workspace', roles: ['admin', 'finance'] },
    ],
  },
  {
    heading: 'Marketing',
    items: [
      { href: '/marketing', label: 'Marketing Dashboard', roles: ['admin', 'marketing'] },
      { href: '/marketing/segments', label: 'Segments', roles: ['admin', 'marketing'] },
      { href: '/marketing/campaigns', label: 'Campaigns', roles: ['admin', 'marketing'] },
      { href: '/marketing/contract-renewals', label: 'Contract Renewals', roles: ['admin', 'marketing'] },
      { href: '/marketing/reports', label: 'Marketing Reports', roles: ['admin', 'marketing'] },
    ],
  },
  {
    heading: 'Executive',
    items: [
      { href: '/executive', label: 'Executive Overview', roles: ['admin', 'executive'] },
      { href: '/executive/branches', label: 'Branch Performance', roles: ['admin', 'executive'] },
      { href: '/executive/contracts', label: 'Contract Risk', roles: ['admin', 'executive'] },
      { href: '/executive/service', label: 'Service Performance', roles: ['admin', 'executive'] },
      { href: '/executive/warehouse', label: 'Warehouse Risk', roles: ['admin', 'executive'] },
      { href: '/executive/reports', label: 'Executive Reports', roles: ['admin', 'executive'] },
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
