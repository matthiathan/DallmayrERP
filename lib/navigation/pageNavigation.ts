import { navSections } from '@/lib/auth/permissions';
import { FLEET_OVERVIEW_LABEL } from '@/lib/navigation/terminology';

export type PageNavigationSection = {
  id: string;
  label: string;
};

export type PageNavigationMetadata = {
  title?: string;
  breadcrumbLabel?: string;
  parent?: {
    href: string;
    label: string;
  };
  sections?: readonly PageNavigationSection[];
};

export type PageBreadcrumb = {
  href: string;
  label: string;
  isLast: boolean;
};

export type PageNavigationModel = {
  backTarget: { href: string; label: string };
  crumbs: PageBreadcrumb[];
  currentLabel: string;
  sections: PageNavigationSection[];
};

type DynamicRecordRule = {
  matches: (segments: string[]) => boolean;
  currentLabel: string;
  parent: { href: string; label: string };
};

const dynamicRecordRules: DynamicRecordRule[] = [
  {
    matches: (segments) => segments.length === 2 && segments[0] === 'customers',
    currentLabel: 'Customer record',
    parent: { href: '/customers', label: 'Customer Master' },
  },
  {
    matches: (segments) => segments.length === 3
      && segments[0] === 'operations'
      && segments[1] === 'assets'
      && !['lifecycle', 'scan'].includes(segments[2] ?? ''),
    currentLabel: 'Machine record',
    parent: { href: '/operations/assets', label: 'Machine Master' },
  },
  {
    matches: (segments) => segments.length === 2
      && segments[0] === 'work'
      && !['execution', 'messages'].includes(segments[1] ?? ''),
    currentLabel: 'Work item',
    parent: { href: '/work', label: 'Action Centre' },
  },
  {
    matches: (segments) => segments.length === 3
      && segments[0] === 'warehouse'
      && segments[1] === 'stock'
      && segments[2] !== 'scan',
    currentLabel: 'Stock item',
    parent: { href: '/warehouse/stock', label: 'Stock Control' },
  },
];

const navigationItems = navSections.flatMap((section) => section.items);

function titleCase(value: string) {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function findNavLabel(pathname: string) {
  const exact = navigationItems.find((item) => item.href === pathname);
  if (exact) return exact.label;

  const parent = [...navigationItems]
    .filter((item) => pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return parent?.label ?? null;
}

function defaultBackTarget(pathname: string) {
  const parent = [...navigationItems]
    .filter((item) => item.href !== pathname && pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return parent
    ? { href: parent.href, label: parent.label }
    : { href: '/', label: FLEET_OVERVIEW_LABEL };
}

function dynamicRecordRule(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  return dynamicRecordRules.find((rule) => rule.matches(segments)) ?? null;
}

function normaliseSections(sections: readonly PageNavigationSection[] | undefined) {
  if (!sections?.length) return [];
  const seen = new Set<string>();
  const result: PageNavigationSection[] = [];

  for (const section of sections) {
    const id = section.id.trim().replace(/^#/, '');
    const label = section.label.trim();
    if (!id || !label || /\s/.test(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, label });
    if (result.length === 10) break;
  }

  return result;
}

export function buildPageNavigation(pathname: string, metadata?: PageNavigationMetadata | null): PageNavigationModel {
  const segments = pathname.split('/').filter(Boolean);
  const dynamicRule = dynamicRecordRule(pathname);
  const explicitCurrentLabel = metadata?.breadcrumbLabel?.trim() || metadata?.title?.trim() || null;
  const currentLabel = explicitCurrentLabel
    ?? dynamicRule?.currentLabel
    ?? findNavLabel(pathname)
    ?? (segments.at(-1) ? titleCase(segments.at(-1) as string) : FLEET_OVERVIEW_LABEL);

  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    const isLast = index === segments.length - 1;
    const label = isLast
      ? currentLabel
      : findNavLabel(href) ?? titleCase(segment);
    return { href, label, isLast };
  });

  return {
    backTarget: metadata?.parent ?? dynamicRule?.parent ?? defaultBackTarget(pathname),
    crumbs,
    currentLabel,
    sections: normaliseSections(metadata?.sections),
  };
}
