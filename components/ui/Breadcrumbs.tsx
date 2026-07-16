'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navSections } from '@/lib/auth/permissions';

function titleCase(value: string) {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function findNavLabel(pathname: string) {
  const items = navSections.flatMap((section) => section.items);
  const exact = items.find((item) => item.href === pathname);
  if (exact) return exact.label;

  const parent = [...items]
    .filter((item) => pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return parent?.label ?? null;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  if (!pathname || pathname === '/' || pathname === '/workspace') return null;

  const segments = pathname.split('/').filter(Boolean);
  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    const isLast = index === segments.length - 1;
    const navLabel = isLast ? findNavLabel(pathname) : findNavLabel(href);
    return { href, label: navLabel ?? titleCase(segment), isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <Link href="/workspace">Workspace</Link>
      {crumbs.map((crumb) => (
        <span className="breadcrumb-item" key={crumb.href}>
          <span aria-hidden="true">/</span>
          {crumb.isLast ? <span aria-current="page">{crumb.label}</span> : <Link href={crumb.href}>{crumb.label}</Link>}
        </span>
      ))}
    </nav>
  );
}
