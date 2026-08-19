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
  '.erp-record-workspace',
  '.customer-360-stage',
  '.customer360-stage',
  '.record-workspace',
  '.record-detail-stage',
  '.asset-detail-stage',
  '.customer-detail-stage',
];

const pageIdentitySelectors = [
  '.erp-page-header',
  '.page-header.hero-panel',
  '.cx-dashboard-hero',
  '.admin-command-header',
];

const urgentSelectors = [
  '[role="alert"]',
  '.erp-state-banner[data-tone="danger"]',
  '.erp-state-banner[data-tone="warning"]',
  '.error',
];

const summarySelectors = [
  '.erp-metric-grid',
  '.spatial-kpi-grid',
  '.admin-command-kpis',
  '.cx-dashboard-kpis',
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

function markPriority(root: HTMLElement, selectors: string[], priority: string, firstOnly = false) {
  const matches = selectors.flatMap((selector) => Array.from(root.querySelectorAll<HTMLElement>(selector)));
  const unique = Array.from(new Set(matches));
  (firstOnly ? unique.slice(0, 1) : unique).forEach((element) => {
    if (!element.dataset.uiPriority) element.dataset.uiPriority = priority;
  });
}

function applyUserFirstHierarchy(root: HTMLElement) {
  root.dataset.userFirstHierarchy = 'true';

  root.querySelectorAll<HTMLElement>('[data-ui-priority]').forEach((element) => {
    if (!element.closest('.telemetry-workspace')) delete element.dataset.uiPriority;
  });

  markPriority(root, pageIdentitySelectors, 'identity', true);
  markPriority(root, urgentSelectors, 'urgent');
  markPriority(root, summarySelectors, 'summary');

  root.querySelectorAll<HTMLElement>('.erp-toolbar, .page-toolbar, .erp-command-bar').forEach((element) => {
    if (!element.dataset.uiPriority) element.dataset.uiPriority = 'action';
  });

  root.querySelectorAll<HTMLElement>('.enterprise-table-shell, .erp-table-shell, .remote-table-shell').forEach((element) => {
    if (!element.dataset.uiPriority) element.dataset.uiPriority = 'detail';
  });
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
  applyUserFirstHierarchy(root);
}

export function PageTemplateFrame() {
  const pathname = usePathname();

  useEffect(() => {
    const routeTemplate = getPageTemplate(pathname);
    let frameId = 0;
    let contentObserver: MutationObserver | null = null;
    let bootstrapObserver: MutationObserver | null = null;

    function schedule(root: HTMLElement) {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => applyTemplate(root, routeTemplate));
    }

    function attachToWorkspace() {
      const root = document.querySelector<HTMLElement>('.application-main');
      if (!root) return false;

      schedule(root);
      contentObserver?.disconnect();
      contentObserver = new MutationObserver(() => schedule(root));
      contentObserver.observe(root, { childList: true, subtree: true });
      return true;
    }

    if (!attachToWorkspace()) {
      bootstrapObserver = new MutationObserver(() => {
        if (attachToWorkspace()) bootstrapObserver?.disconnect();
      });
      bootstrapObserver.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      contentObserver?.disconnect();
      bootstrapObserver?.disconnect();
    };
  }, [pathname]);

  return null;
}
