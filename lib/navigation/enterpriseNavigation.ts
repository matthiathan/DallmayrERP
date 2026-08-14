import type { NavSection } from '@/lib/auth/permissions';
import type { BusinessRole } from '@/types/dallmayrerp';

export const ENTERPRISE_NAVIGATION_HEADINGS = [
  'Work',
  'Customers & Assets',
  'Inventory',
  'Commercial',
  'Insights',
  'Administration',
] as const;

export type EnterpriseNavigationHeading = typeof ENTERPRISE_NAVIGATION_HEADINGS[number];

const ENTERPRISE_NAVIGATION_ROLES = new Set<BusinessRole>(['admin', 'executive']);

export function isEnterpriseNavigationRole(role: BusinessRole) {
  return ENTERPRISE_NAVIGATION_ROLES.has(role);
}

export function enterpriseNavigationHeadingFor(sectionHeading: string, href: string): EnterpriseNavigationHeading {
  if (href === '/workspace' || href === '/work' || href.startsWith('/work/')) return 'Work';

  if (href === '/warehouse' || href.startsWith('/warehouse/')) return 'Inventory';

  if (
    href === '/customers'
    || href.startsWith('/customers/')
    || href === '/operations/assets'
    || href.startsWith('/operations/assets/')
    || href === '/operations/reliability'
    || href.startsWith('/operations/reliability/')
    || href === '/operations/maintenance'
    || href.startsWith('/operations/maintenance/')
  ) {
    return 'Customers & Assets';
  }

  if (
    href === '/sales'
    || href.startsWith('/sales/')
    || href === '/marketing'
    || href.startsWith('/marketing/')
    || href === '/finance'
    || href.startsWith('/finance/')
  ) {
    return 'Commercial';
  }

  if (
    href === '/executive'
    || href.startsWith('/executive/')
    || href === '/telemetry'
    || href.startsWith('/telemetry/')
    || href === '/operations/reports'
    || href.startsWith('/operations/reports/')
  ) {
    return 'Insights';
  }

  if (
    href === '/'
    || href === '/admin'
    || href.startsWith('/admin/')
    || href === '/utilities'
    || href.startsWith('/utilities/')
  ) {
    return 'Administration';
  }

  if (sectionHeading === 'Reports' || sectionHeading === 'Batch Reports' || sectionHeading === 'Telemetry') return 'Insights';
  if (sectionHeading === 'Masters' || sectionHeading === 'Fixed Assets') return 'Customers & Assets';
  if (sectionHeading === 'Sales') return 'Commercial';
  if (sectionHeading === 'System' || sectionHeading === 'Utilities') return 'Administration';

  return 'Work';
}

export function groupEnterpriseNavigationSections(role: BusinessRole, sections: NavSection[]): NavSection[] {
  if (!isEnterpriseNavigationRole(role)) return sections;

  const grouped = new Map<EnterpriseNavigationHeading, NavSection['items']>(
    ENTERPRISE_NAVIGATION_HEADINGS.map((heading) => [heading, []]),
  );
  const seen = new Set<string>();

  for (const section of sections) {
    for (const item of section.items) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      grouped.get(enterpriseNavigationHeadingFor(section.heading, item.href))?.push(item);
    }
  }

  return ENTERPRISE_NAVIGATION_HEADINGS.flatMap((heading) => {
    const items = grouped.get(heading) ?? [];
    return items.length ? [{ heading, items }] : [];
  });
}
