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
      { href: '/alerts', label: 'Alerts', code: 'FLT03', roles: 'all', description: 'Active faults, ownership, acknowledgement and resolution workflow.' },
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
      { href: '/users', label: 'Users & Client Access', code: 'USR01', roles: ['admin'], description: 'Create Dallmayr staff access and customer-scoped client logins.' },
    ],
  },
];

function sectionsForAccount(accountScope: AccountScope, role: string | null | undefined) {
  return telemetryNavigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (accountScope === 'client') return CLIENT_ALLOWED_PATHS.has(item.href);
        if (item.href === '/users') return role === 'admin';
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

export function canAccessShellPath(pathname: string, accountScope: AccountScope = 'dallmayr', role?: string | null) {
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
