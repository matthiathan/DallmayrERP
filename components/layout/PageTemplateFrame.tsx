'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getPageTemplate,
  pageTemplateLabel,
  type PageTemplate,
} from '@/lib/layout/page-templates';

const operationalSelectors = [
  '.exception-centre-layout',
  '.operations-dispatch-layout',
  '.field-service-workspace',
  '.admin-user-access-stage',
  '.admin-access-layout',
  '.mobile-master-detail-root',
  '[data-mobile-master-detail]',
];

const recordSelectors = [
  '.customer-360-stage',
  '.customer360-stage',
  '.record-workspace',
  '.record-detail-stage',
  '.asset-detail-stage',
  '.customer-detail-stage',
];

function containsAny(root: HTMLElement, selectors: string[]) {
  return selectors.some((selector) => Boolean(root.querySelector(selector)));
}

function detectLegacyTemplate(root: HTMLElement): PageTemplate {
  if (containsAny(root, operationalSelectors)) return 'operational';
  if (containsAny(root, recordSelectors)) return 'record';
  if (root.querySelector('.enterprise-table-shell, .remote-table-shell')) return 'list';
  if (root.querySelector('.kpi-card, .grid-4, .grid-5, .grid-6, [class*="dashboard"]')) return 'dashboard';
  if (root.querySelector('form')) return 'form';
  return 'default';
}

export function PageTemplateFrame({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const routeTemplate = useMemo(() => getPageTemplate(pathname), [pathname]);
  const [detectedTemplate, setDetectedTemplate] = useState<PageTemplate>('default');
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = frameRef.current;
    if (!root) return;

    function updateTemplate() {
      setDetectedTemplate(detectLegacyTemplate(root));
    }

    updateTemplate();
    const observer = new MutationObserver(updateTemplate);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  const template = routeTemplate === 'default' ? detectedTemplate : routeTemplate;

  return (
    <div
      aria-label={pageTemplateLabel(template)}
      className={`workspace-template-frame template-${template}`}
      data-page-template={template}
      ref={frameRef}
    >
      {children}
    </div>
  );
}
