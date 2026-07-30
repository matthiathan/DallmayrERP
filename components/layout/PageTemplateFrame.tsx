'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
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

function applyTemplate(root: HTMLElement, routeTemplate: PageTemplate) {
  const detectedTemplate = detectLegacyTemplate(root);
  const template = routeTemplate === 'default' ? detectedTemplate : routeTemplate;

  root.dataset.pageTemplate = template;
  root.setAttribute('aria-label', pageTemplateLabel(template));
  root.classList.remove(
    'template-dashboard',
    'template-list',
    'template-record',
    'template-operational',
    'template-form',
    'template-default',
  );
  root.classList.add('workspace-template-frame', `template-${template}`);
}

export function PageTemplateFrame() {
  const pathname = usePathname();

  useEffect(() => {
    const routeTemplate = getPageTemplate(pathname);

    function synchronizeTemplate() {
      const root = document.querySelector<HTMLElement>('.application-main');
      if (root) applyTemplate(root, routeTemplate);
    }

    synchronizeTemplate();
    const observer = new MutationObserver(synchronizeTemplate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
