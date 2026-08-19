import {
  canAccessPath,
  getDefaultPathForRole,
  isNavItemAllowed,
  navSections,
  type NavSection,
} from '@/lib/auth/permissions';
import { selectActiveNavigationHref } from '@/lib/navigation/activeNavigation';
import { groupEnterpriseNavigationSections } from '@/lib/navigation/enterpriseNavigation';
import { getSupplementalNavigationSections } from '@/lib/navigation/supplementalNavigation';
import { TODAY_LABEL } from '@/lib/navigation/terminology';
import type { BusinessRole } from '@/types/dallmayrerp';

const MESSAGING_ENABLED = process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED === 'true';

function getTelemetryFocusedSections(role: BusinessRole, supplementalSections: NavSection[]): NavSection[] {
  const canReadTelemetry = role === 'admin' || role === 'executive';
  const deviceAdministration = supplementalSections
    .flatMap((section) => section.items)
    .filter((item) => item.href === '/telemetry/devices');

  return [
    {
      heading: 'Monitoring',
      items: [
        { href: '/workspace', label: 'Fleet Overview', code: 'FLT01', roles: 'all', description: 'Fleet health, sales counters, faults and connectivity.' },
        { href: '/machines', label: 'Machines', code: 'FLT02', roles: 'all', description: 'Every machine and its connected telemetry device.' },
        ...(canReadTelemetry ? [{ href: '/alerts', label: 'Alerts', code: 'FLT03', roles: 'all' as const, description: 'Current machine faults and devices needing attention.' }] : []),
      ],
    },
    ...(canReadTelemetry ? [{
      heading: 'Telemetry',
      items: [
        { href: '/telemetry', label: 'Analytics', code: 'TEL01', roles: 'all' as const, description: 'Item quantities, trends, failures and activity.' },
        { href: '/map', label: 'Machine Map', code: 'TEL03', roles: 'all' as const, description: 'Last known device locations and movement.' },
      ],
    }] : []),
    ...(role === 'admin' && deviceAdministration.length > 0 ? [{ heading: 'Management', items: deviceAdministration.map((item) => ({ ...item, label: 'Device Management' })) }] : []),
  ];
}

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
  if (pathname === '/workspace' || pathname === '/machines' || pathname.startsWith('/machines/')) return true;
  if (pathname === '/alerts' || pathname === '/map') return role === 'admin' || role === 'executive';
  const telemetryPathAllowed = pathname === '/telemetry'
    ? role === 'admin' || role === 'executive'
    : pathname.startsWith('/telemetry/devices') && role === 'admin';
  return canAccessPath(role, pathname) || telemetryPathAllowed;
}

export function deriveAppShellNavigation(role: BusinessRole, pathname: string) {
  const homePath = getDefaultPathForRole(role);
  const allowedPath = canAccessShellPath(role, pathname);
  const supplementalSections = getSupplementalNavigationSections(role, MESSAGING_ENABLED);
  const focusedSections = getTelemetryFocusedSections(role, supplementalSections);
  const orderedNavigationSections = orderNavigationSections(role, focusedSections);
  const navigationSections = role === 'admin' || role === 'executive'
    ? orderedNavigationSections
    : groupEnterpriseNavigationSections(role, orderedNavigationSections);
  const allNavigationItems = navigationSections.flatMap((section) => section.items);
  const activeHref = selectActiveNavigationHref(pathname, allNavigationItems.map((item) => item.href));
  const activeSection = activeHref
    ? navigationSections.find((section) => section.items.some((item) => item.href === activeHref))
    : undefined;
  const activeItem = activeHref
    ? activeSection?.items.find((item) => item.href === activeHref)
    : undefined;
  const activeTitle = activeItem?.label ?? TODAY_LABEL;
  const visibleHrefs = new Set(allNavigationItems.map((item) => item.href));
  const statusQuickLinks = [
    { href: '/machines', label: 'Machines' },
    { href: '/alerts', label: 'Alerts' },
    { href: '/telemetry', label: 'Analytics' },
  ].filter((item) => visibleHrefs.has(item.href));
  const mobileTaskPath = '/machines';
  const mobileScanPath = '/machines';

  return {
    activeHref,
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
