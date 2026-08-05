'use client';

import Link from 'next/link';
import type { NavItem, NavSection } from '@/lib/auth/permissions';

type DesktopNavigationRailProps = {
  collapsed: boolean;
  homePath: string;
  onToggleCollapse: () => void;
  onToggleFavorite: (href: string) => void;
  pathname: string;
  pinnedItems: NavItem[];
  roleLabel: string;
  sections: NavSection[];
};

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

function navigationGlyph(label: string) {
  const words = label.replace(/&/g, ' ').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join('') : label.slice(0, 2)).toUpperCase();
}

function uniqueItems(sections: NavSection[]) {
  const seen = new Set<string>();
  return sections.flatMap((section) => section.items).filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

export function DesktopNavigationRail({
  collapsed,
  homePath,
  onToggleCollapse,
  pathname,
  roleLabel,
  sections,
}: DesktopNavigationRailProps) {
  const items = uniqueItems(sections);

  return (
    <aside aria-label="Application navigation" className={`dallmayr-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="dallmayr-sidebar-brand">
        <Link href={homePath} aria-label="Open Dallmayr ERP home">
          <span aria-hidden="true" className="dallmayr-crest">D</span>
          {!collapsed ? <span><strong>Dallmayr</strong><small>ERP</small></span> : null}
        </Link>
        <button aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={onToggleCollapse} type="button">
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <nav className="dallmayr-sidebar-nav" aria-label="ERP modules">
        <Link className="dallmayr-sidebar-link" aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} href={homePath} title="Dashboard">
          <span aria-hidden="true">DB</span>{!collapsed ? <strong>Dashboard</strong> : null}
        </Link>
        {items.filter((item) => item.href !== homePath && item.href !== '/work').map((item) => (
          <Link
            aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
            className="dallmayr-sidebar-link"
            href={item.href}
            key={item.href}
            title={item.label}
          >
            <span aria-hidden="true">{navigationGlyph(item.label)}</span>
            {!collapsed ? <strong>{item.label}</strong> : null}
          </Link>
        ))}
      </nav>

      <div className="dallmayr-sidebar-account">
        <span aria-hidden="true" className="dallmayr-account-avatar">{roleLabel.slice(0, 1)}</span>
        {!collapsed ? <span><strong>{roleLabel}</strong><small>Signed in</small></span> : null}
      </div>
    </aside>
  );
}
