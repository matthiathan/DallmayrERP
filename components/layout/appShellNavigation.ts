import type { NavSection } from '@/lib/auth/permissions';
import { selectActiveNavigationHref } from '@/lib/navigation/activeNavigation';

const TELEMETRY_HOME_PATH = '/';

const telemetryNavigationSections: NavSection[] = [
  {
    heading: 'Monitoring',
    items: [
      { href: '/', label: 'Fleet Overview', code: 'FLT01', roles: 'all', description: 'Fleet health, sales counters, faults and connectivity.' },
      { href: '/machines', label: 'Machines', code: 'FLT02', roles: 'all', description: 'Every machine and its connected telemetry device.' },
      { href: '/alerts', label: 'Alerts', code: 'FLT03', roles: 'all', description: 'Current machine faults and devices needing attention.' },
    ],
  },
  {
    heading: 'Telemetry',
    items: [
      { href: '/telemetry', label: 'Analytics', code: 'TEL01', roles: 'all', description: 'Item quantities, trends, failures and activity.' },
      { href: '/telemetry/test-center', label: 'Test Center', code: 'TEL04', roles: 'all', description: 'Temporary remote console and commissioning diagnostics.' },
      { href: '/map', label: 'Machine Map', code: 'TEL03', roles: 'all', description: 'Last known device locations and movement.' },
    ],
  },
  {
    heading: 'Management',
    items: [
      { href: '/telemetry/devices', label: 'Device Management', code: 'TEL02', roles: 'all', description: 'Device assignment, reporting frequency and connectivity settings.' },
    ],
  },
];

export function canAccessShellPath(pathname: string) {
  if (pathname === TELEMETRY_HOME_PATH) return true;
  return telemetryNavigationSections.some((section) => section.items.some((item) => (
    pathname === item.href || pathname.startsWith(`${item.href}/`)
  )));
}

export function deriveAppShellNavigation(pathname: string) {
  const allNavigationItems = telemetryNavigationSections.flatMap((section) => section.items);
  const activeHref = selectActiveNavigationHref(pathname, allNavigationItems.map((item) => item.href));
  const activeSection = activeHref
    ? telemetryNavigationSections.find((section) => section.items.some((item) => item.href === activeHref))
    : undefined;
  const activeItem = activeHref
    ? activeSection?.items.find((item) => item.href === activeHref)
    : undefined;

  return {
    activeHref,
    activeSection,
    activeTitle: activeItem?.label ?? 'Fleet Overview',
    allowedPath: canAccessShellPath(pathname),
    homePath: TELEMETRY_HOME_PATH,
    mobileTaskPath: '/machines',
    navigationSections: telemetryNavigationSections,
    statusQuickLinks: [
      { href: '/machines', label: 'Machines' },
      { href: '/alerts', label: 'Alerts' },
      { href: '/telemetry', label: 'Analytics' },
    ],
  };
}
