import type { NavSection } from '@/lib/auth/permissions';
import { selectActiveNavigationHref } from '@/lib/navigation/activeNavigation';
import type { AccountScope } from '@/types/dallmayrerp';

const TELEMETRY_HOME_PATH = '/';
const CLIENT_ALLOWED_PATHS = new Set(['/', '/machines', '/telemetry', '/telemetry/reports', '/map']);

export const telemetryNavigationSections: NavSection[] = [
  {
    heading: 'Monitoring',
    items: [
      { href: '/', label: 'Fleet Overview', code: 'FLT01', roles: 'all', description: 'Fleet health, exceptions, faults and current connectivity.' },
      { href: '/machines', label: 'Machines', code: 'FLT02', roles: 'all', description: 'Every machine and its connected telemetry device.' },
      { href: '/customers', label: 'Customers / Sites', code: 'FLT04', roles: 'all', description: 'Customer hierarchy, sites, installed machines and service context.' },
      { href: '/archive', label: 'Archive', code: 'FLT05', roles: ['admin', 'operations', 'technician', 'road_technician'], description: 'Retired machines and telemetry devices with history and controlled reactivation.' },
      { href: '/alerts', label: 'Alerts', code: 'FLT03', roles: 'all', description: 'Active faults, ownership, acknowledgement and resolution workflow.' },
      { href: '/maintenance', label: 'Maintenance', code: 'OPS02', roles: 'all', description: 'Service jobs, preventive maintenance, technician workload and completion.' },
    ],
  },
  {
    heading: 'Telemetry',
    items: [
      { href: '/telemetry', label: 'Analytics', code: 'TEL01', roles: 'all', description: 'Explore trends, comparisons and performance signals.' },
      { href: '/telemetry/reports', label: 'Reports & Exports', code: 'TEL05', roles: 'all', description: 'Structured operational tables, audit views and exports.' },
      { href: '/telemetry/test-center', label: 'Test Center', code: 'TEL04', roles: 'all', description: 'Temporary remote console and commissioning diagnostics.' },
      { href: '/map', label: 'Machine Map', code: 'TEL03', roles: 'all', description: 'Last known device locations, health and movement.' },
    ],
  },
  {
    heading: 'Management',
    items: [
      { href: '/products', label: 'Products', code: 'PRD01', roles: 'all', description: 'Product catalog, machine mappings and unmapped selections.' },
      { href: '/telemetry/devices', label: 'Device Management', code: 'TEL02', roles: 'all', description: 'Device assignment, connectivity, reporting, location and SIM settings.' },
      { href: '/administration', label: 'Administration', code: 'ADM01', roles: ['admin'], description: 'Users, roles, profiles, provisioning, firmware, audit and settings.' },
      { href: '/approvals', label: 'Approvals', code: 'APR01', roles: ['admin'], description: 'Approval evidence, decision history and risk-policy prerequisites.' },
      { href: '/factory', label: 'Factory', code: 'FAC01', roles: ['admin'], description: 'Factory device readiness, provisioning evidence, testing and QA prerequisites.' },
    ],
  },
];

function clientCanAccessPath(pathname: string) {
  if (CLIENT_ALLOWED_PATHS.has(pathname)) return true;
  return pathname.startsWith('/machines/');
}

function sectionsForAccount(accountScope: AccountScope, role: string | null | undefined) {
  return telemetryNavigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (accountScope === 'client') return CLIENT_ALLOWED_PATHS.has(item.href);
        if (item.href === '/administration' || item.href === '/approvals' || item.href === '/factory') return role === 'admin';
        if (item.href === '/archive') return ['admin', 'operations', 'technician', 'road_technician'].includes(role ?? '');
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

export function canAccessShellPath(pathname: string, accountScope: AccountScope = 'dallmayr', role?: string | null) {
  if (accountScope === 'client') return clientCanAccessPath(pathname);
  if (pathname === TELEMETRY_HOME_PATH) return true;
  const sections = sectionsForAccount(accountScope, role);
  return sections.some((section) => section.items.some((item) => (
    pathname === item.href || pathname.startsWith(`${item.href}/`)
  )));
}

export function deriveAppShellNavigation(pathname: string, accountScope: AccountScope = 'dallmayr', role?: string | null) {
  const navigationSections = sectionsForAccount(accountScope, role);
  const allNavigationItems = navigationSections.flatMap((section) => section.items);
  const activeHref = selectActiveNavigationHref(pathname, allNavigationItems.map((item) => item.href));
  const activeSection = activeHref
    ? navigationSections.find((section) => section.items.some((item) => item.href === activeHref))
    : undefined;
  const activeItem = activeHref
    ? activeSection?.items.find((item) => item.href === activeHref)
    : undefined;

  return {
    activeHref,
    activeSection,
    activeTitle: activeItem?.label ?? 'Fleet Overview',
    allowedPath: canAccessShellPath(pathname, accountScope, role),
    homePath: TELEMETRY_HOME_PATH,
    mobileTaskPath: '/machines',
    navigationSections,
    statusQuickLinks: accountScope === 'client'
      ? [
        { href: '/machines', label: 'Machines' },
        { href: '/telemetry', label: 'Analytics' },
        { href: '/map', label: 'Machine Map' },
      ]
      : [
        { href: '/machines', label: 'Machines' },
        { href: '/alerts', label: 'Alerts' },
        { href: '/telemetry', label: 'Analytics' },
      ],
  };
}
