import {
  canAccessPath,
  getDefaultPathForRole,
  isNavItemAllowed,
  navSections,
  type NavSection,
} from '@/lib/auth/permissions';
import { groupEnterpriseNavigationSections } from '@/lib/navigation/enterpriseNavigation';
import { TODAY_LABEL } from '@/lib/navigation/terminology';
import type { BusinessRole } from '@/types/dallmayrerp';

const MESSAGING_ENABLED = process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED === 'true';

const sectionOrderByRole: Record<BusinessRole, string[]> = {
  admin: ['System', 'Telemetry', 'Communications', 'Transactions', 'Masters', 'Fixed Assets', 'Sales', 'Reports', 'Batch Reports', 'Utilities'],
  operations: ['Communications', 'Operations', 'Assets & Maintenance', 'Inventory', 'Reports'],
  sales: ['Communications', 'Sales', 'Masters', 'Transactions', 'Reports', 'Utilities'],
  finance: ['Communications', 'Sales', 'Transactions', 'Masters', 'Reports', 'Batch Reports', 'Utilities'],
  marketing: ['Communications', 'Sales', 'Masters', 'Reports', 'Batch Reports', 'Transactions', 'Utilities'],
  executive: ['Communications', 'Reports', 'Telemetry', 'Transactions', 'Fixed Assets', 'Masters', 'Sales', 'Batch Reports', 'Utilities'],
  warehouse_staff: ['Communications', 'Transactions', 'Masters', 'Reports', 'Batch Reports', 'Utilities'],
  technician: ['Communications', 'Transactions', 'Fixed Assets', 'Masters', 'Utilities'],
  road_technician: ['Communications', 'Transactions', 'Fixed Assets', 'Masters', 'Utilities'],
};

const primaryPathCandidates: Record<BusinessRole, string[]> = {
  admin: ['/work', '/admin/users', '/'],
  operations: ['/operations/dispatch', '/operations/exceptions', '/work'],
  sales: ['/sales', '/customers', '/work'],
  finance: ['/finance', '/finance/service-coverage', '/work'],
  marketing: ['/marketing', '/marketing/campaigns', '/work'],
  executive: ['/executive/command-centre', '/executive', '/work'],
  warehouse_staff: ['/warehouse/stock', '/warehouse/planning', '/work'],
  technician: ['/technician', '/work'],
  road_technician: ['/road-tech', '/work'],
};

function telemetryNavigationForRole(role: BusinessRole): NavSection[] {
  if (role !== 'admin' && role !== 'executive') return [];

  return [{
    heading: 'Telemetry',
    items: [
      {
        href: '/telemetry',
        label: 'Machine Telemetry',
        code: 'TEL01',
        roles: ['admin', 'executive'],
        description: 'Daily, weekly, monthly and six-month machine sales and connectivity reporting.',
      },
      ...(role === 'admin' ? [{
        href: '/telemetry/devices',
        label: 'Telemetry Devices',
        code: 'TEL02',
        roles: ['admin'] as BusinessRole[],
        description: 'Assign devices to ERP machines and control telemetry ingestion.',
      }] : []),
    ],
  }];
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

function orderNavigationSections(role: BusinessRole, sections: NavSection[]) {
  const order = sectionOrderByRole[role];
  const rank = new Map(order.map((heading, index) => [heading, index]));
  const seen = new Set<string>();

  return sections
    .filter((section) => section.heading !== 'Windows')
    .sort((left, right) => (rank.get(left.heading) ?? 99) - (rank.get(right.heading) ?? 99))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

export function canAccessShellPath(role: BusinessRole, pathname: string) {
  const telemetryPathAllowed = pathname === '/telemetry'
    ? role === 'admin' || role === 'executive'
    : pathname.startsWith('/telemetry/devices') && role === 'admin';
  return canAccessPath(role, pathname) || telemetryPathAllowed;
}

export function deriveAppShellNavigation(role: BusinessRole, pathname: string) {
  const homePath = getDefaultPathForRole(role);
  const allowedPath = canAccessShellPath(role, pathname);
  const roleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemAllowed(role, item)),
    }))
    .filter((section) => section.items.length > 0);
  const messagingSection: NavSection[] = MESSAGING_ENABLED ? [{
    heading: 'Communications',
    items: [{
      href: '/work/messages',
      label: 'Messages',
      code: 'MSG01',
      roles: 'all',
      description: 'Direct and group conversations with colleagues.',
    }],
  }] : [];
  const orderedNavigationSections = orderNavigationSections(role, [
    ...messagingSection,
    ...telemetryNavigationForRole(role),
    ...roleSections,
  ]);
  const navigationSections = groupEnterpriseNavigationSections(role, orderedNavigationSections);
  const allNavigationItems = navigationSections.flatMap((section) => section.items);
  const activeSection = navigationSections.find((section) => section.items.some((item) => isActivePath(pathname, item.href)));
  const activeItem = activeSection?.items.find((item) => isActivePath(pathname, item.href));
  const activeTitle = activeItem?.label ?? TODAY_LABEL;
  const visibleHrefs = new Set(allNavigationItems.map((item) => item.href));
  const statusQuickLinks = [
    ...(MESSAGING_ENABLED ? [{ href: '/work/messages', label: 'Messages' }] : []),
    { href: '/work', label: 'My Work' },
    { href: '/operations/exceptions', label: 'Exceptions' },
    { href: '/operations/dispatch', label: 'Dispatch' },
    { href: '/warehouse/stock', label: 'Stock' },
  ].filter((item) => item.href === '/work' || visibleHrefs.has(item.href)).slice(0, 3);
  const mobileTaskPath = primaryPathCandidates[role].find((href) => visibleHrefs.has(href)) ?? homePath;
  const mobileScanPath = role === 'warehouse_staff' ? '/warehouse/stock/scan' : '/operations/assets/scan';

  return {
    activeSection,
    activeTitle,
    allowedPath,
    homePath,
    mobileScanPath,
    mobileTaskPath,
    navigationSections,
    statusQuickLinks,
  };
}
