'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { navSections } from '@/lib/auth/permissions';
import { TODAY_LABEL } from '@/lib/navigation/terminology';

type MobileSection = {
  id: string;
  label: string;
};

const SECTION_SELECTOR = [
  '.page-toolbar-heading h2',
  '.minimal-panel-header h2',
  '.workspace-section-heading h2',
  '.neo-card > h2',
  '.card > h2',
  '.exception-list-heading h2',
  '.field-section-header h3',
].join(',');

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

function findBackTarget(pathname: string) {
  const items = navSections.flatMap((section) => section.items);
  const parent = [...items]
    .filter((item) => item.href !== pathname && pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return parent
    ? { href: parent.href, label: parent.label }
    : { href: '/workspace', label: TODAY_LABEL };
}

function sectionId(label: string, index: number) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `mobile-section-${slug || 'section'}-${index + 1}`;
}

function collectSections(main: HTMLElement) {
  const seenElements = new Set<Element>();
  const seenLabels = new Set<string>();
  const next: MobileSection[] = [];

  main.querySelectorAll<HTMLElement>(SECTION_SELECTOR).forEach((heading, index) => {
    if (seenElements.has(heading) || heading.closest('.mobile-section-index')) return;
    const label = heading.textContent?.replace(/\s+/g, ' ').trim();
    if (!label || label.length < 3 || seenLabels.has(label)) return;

    seenElements.add(heading);
    seenLabels.add(label);
    if (!heading.id) heading.id = sectionId(label, index);
    next.push({ id: heading.id, label });
  });

  return next.slice(0, 10);
}

function sameSections(left: MobileSection[], right: MobileSection[]) {
  return left.length === right.length
    && left.every((item, index) => item.id === right[index]?.id && item.label === right[index]?.label);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const [mobileSections, setMobileSections] = useState<MobileSection[]>([]);

  useEffect(() => {
    const main = document.getElementById('main-content');
    if (!main) return;

    let frame = 0;
    const scan = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = collectSections(main);
        setMobileSections((current) => sameSections(current, next) ? current : next);
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(main, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  const crumbs = useMemo(() => {
    if (!pathname) return [];
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const href = `/${segments.slice(0, index + 1).join('/')}`;
      const isLast = index === segments.length - 1;
      const navLabel = isLast ? findNavLabel(pathname) : findNavLabel(href);
      return { href, label: navLabel ?? titleCase(segment), isLast };
    });
  }, [pathname]);

  if (!pathname) return null;

  const isRoot = pathname === '/';
  const isWorkspace = pathname === '/workspace';
  const backTarget = findBackTarget(pathname);
  const currentLabel = crumbs.at(-1)?.label ?? TODAY_LABEL;
  const showSectionIndex = mobileSections.length >= 3;

  return (
    <>
      {!isRoot && !isWorkspace ? (
        <nav aria-label="Back navigation" className="mobile-page-navigation">
          <Link className="mobile-page-back" href={backTarget.href}>
            <span aria-hidden="true">←</span>
            <span>Back to {backTarget.label}</span>
          </Link>
          <span className="mobile-page-current">{currentLabel}</span>
        </nav>
      ) : null}

      {showSectionIndex ? (
        <nav aria-label="On this page" className="mobile-section-index">
          {mobileSections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>{section.label}</a>
          ))}
        </nav>
      ) : null}

      {!isRoot && !isWorkspace ? (
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <Link href="/workspace">{TODAY_LABEL}</Link>
          {crumbs.map((crumb) => (
            <span className="breadcrumb-item" key={crumb.href}>
              <span aria-hidden="true">/</span>
              {crumb.isLast ? <span aria-current="page">{crumb.label}</span> : <Link href={crumb.href}>{crumb.label}</Link>}
            </span>
          ))}
        </nav>
      ) : null}
    </>
  );
}
