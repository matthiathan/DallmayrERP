'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type WorkflowId = 'exceptions' | 'field-service' | 'admin-access';

type WorkflowConfig = {
  id: WorkflowId;
  rootSelector: string;
  stageSelector: string;
  listSelector: string;
  detailSelector: string;
  triggerSelector: string;
  listLabel: string;
  titleSelector: string;
};

type ActiveWorkflow = {
  id: WorkflowId;
  root: HTMLElement;
  stage: HTMLElement;
  list: HTMLElement | null;
  detail: HTMLElement;
  trigger: HTMLElement;
  scrollY: number;
  historyToken: string;
  listLabel: string;
  title: string;
};

const MOBILE_QUERY = '(max-width: 900px)';

const workflowConfigs: WorkflowConfig[] = [
  {
    id: 'exceptions',
    rootSelector: '.exception-centre-layout',
    stageSelector: '.exception-centre-stage',
    listSelector: '.exception-case-list',
    detailSelector: '.exception-case-detail',
    triggerSelector: '.exception-case-card',
    listLabel: 'Exception cases',
    titleSelector: 'strong',
  },
  {
    id: 'field-service',
    rootSelector: '.field-service-layout',
    stageSelector: '.field-service-workspace',
    listSelector: '.field-job-queue',
    detailSelector: '.field-execution',
    triggerSelector: '.field-job-card',
    listLabel: 'Assigned jobs',
    titleSelector: '.field-job-card-top strong',
  },
  {
    id: 'admin-access',
    rootSelector: '.admin-access-stage',
    stageSelector: '.admin-access-stage',
    listSelector: '.admin-access-section:has(.enterprise-table-shell)',
    detailSelector: '.admin-access-editor',
    triggerSelector: '.mobile-record-card .compact-action',
    listLabel: 'User access records',
    titleSelector: '.mobile-record-card-title > div',
  },
];

function cleanText(value: string | null | undefined, fallback: string) {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function setElementInert(element: HTMLElement | null, inert: boolean) {
  if (!element) return;
  element.inert = inert;
  if (inert) element.setAttribute('aria-hidden', 'true');
  else element.removeAttribute('aria-hidden');
}

function scannerDestination(href: string | null) {
  if (href === '/warehouse/stock') return '/warehouse/stock/scan';
  if (href === '/operations/assets') return '/operations/assets/scan';
  return null;
}

export function MobileWorkflowEnhancer() {
  const pathname = usePathname();
  const activeRef = useRef<ActiveWorkflow | null>(null);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const [activeSummary, setActiveSummary] = useState<Pick<ActiveWorkflow, 'id' | 'listLabel' | 'title'> | null>(null);

  const closeWorkflow = useCallback((restoreScroll = true) => {
    const active = activeRef.current;
    if (!active) return;

    active.root.removeAttribute('data-mobile-workflow');
    if (active.stage !== active.root) active.stage.removeAttribute('data-mobile-workflow');
    setElementInert(active.list, false);
    setElementInert(active.detail, true);
    document.documentElement.classList.remove('mobile-workflow-detail-open');
    activeRef.current = null;
    setActiveSummary(null);

    window.requestAnimationFrame(() => {
      if (restoreScroll) window.scrollTo({ top: active.scrollY, behavior: 'auto' });
      active.trigger.focus({ preventScroll: true });
    });
  }, []);

  const requestClose = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    if (window.history.state?.dallmayrMobileWorkflow === active.historyToken) {
      window.history.back();
      return;
    }
    closeWorkflow(true);
  }, [closeWorkflow]);

  const openWorkflow = useCallback((config: WorkflowConfig, trigger: HTMLElement) => {
    if (!window.matchMedia(MOBILE_QUERY).matches) return;

    const root = trigger.closest<HTMLElement>(config.rootSelector) ?? document.querySelector<HTMLElement>(config.rootSelector);
    const stage = trigger.closest<HTMLElement>(config.stageSelector) ?? document.querySelector<HTMLElement>(config.stageSelector);
    const detail = stage?.querySelector<HTMLElement>(config.detailSelector) ?? document.querySelector<HTMLElement>(config.detailSelector);
    const list = stage?.querySelector<HTMLElement>(config.listSelector) ?? document.querySelector<HTMLElement>(config.listSelector);
    if (!root || !stage || !detail) return;

    if (activeRef.current) closeWorkflow(false);

    const titleHost = trigger.closest('.mobile-record-card') ?? trigger;
    const title = cleanText(titleHost.querySelector<HTMLElement>(config.titleSelector)?.textContent, config.listLabel);
    const historyToken = `${config.id}:${Date.now()}`;
    const active: ActiveWorkflow = {
      id: config.id,
      root,
      stage,
      list,
      detail,
      trigger,
      scrollY: window.scrollY,
      historyToken,
      listLabel: config.listLabel,
      title,
    };

    activeRef.current = active;
    root.dataset.mobileWorkflow = 'detail';
    stage.dataset.mobileWorkflow = 'detail';
    setElementInert(list, true);
    setElementInert(detail, false);
    document.documentElement.classList.add('mobile-workflow-detail-open');
    setActiveSummary({ id: config.id, listLabel: config.listLabel, title });

    window.history.pushState(
      { ...window.history.state, dallmayrMobileWorkflow: historyToken },
      '',
      window.location.href,
    );

    window.requestAnimationFrame(() => {
      detail.scrollIntoView({ behavior: 'auto', block: 'start' });
      window.requestAnimationFrame(() => backButtonRef.current?.focus({ preventScroll: true }));
    });
  }, [closeWorkflow]);

  useEffect(() => {
    closeWorkflow(false);
  }, [closeWorkflow, pathname]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    let requestedJob = ['/technician', '/road-tech'].includes(pathname)
      ? new URLSearchParams(window.location.search).get('job')?.trim() ?? ''
      : '';

    function clearRequestedJobParameter() {
      const url = new URL(window.location.href);
      url.searchParams.delete('job');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }

    function tryOpenRequestedJob() {
      if (!media.matches || !requestedJob || activeRef.current) return;
      const card = Array.from(document.querySelectorAll<HTMLElement>('.field-job-card')).find((item) => (
        cleanText(item.querySelector<HTMLElement>('.field-job-card-top strong')?.textContent, '') === requestedJob
      ));
      if (!card) return;
      requestedJob = '';
      clearRequestedJobParameter();
      card.click();
    }

    function handleDocumentClick(event: MouseEvent) {
      if (!media.matches || !(event.target instanceof Element)) return;

      const quickBarLink = event.target.closest<HTMLAnchorElement>('.mobile-quick-bar a');
      if (quickBarLink && cleanText(quickBarLink.textContent, '').includes('Scan')) {
        const destination = scannerDestination(quickBarLink.getAttribute('href'));
        if (destination) {
          event.preventDefault();
          event.stopPropagation();
          window.location.assign(destination);
          return;
        }
      }

      for (const config of workflowConfigs) {
        const trigger = event.target.closest<HTMLElement>(config.triggerSelector);
        if (!trigger) continue;
        window.requestAnimationFrame(() => openWorkflow(config, trigger));
        break;
      }
    }

    function handlePopState() {
      if (activeRef.current) closeWorkflow(true);
    }

    function handleViewportChange(event: MediaQueryListEvent) {
      if (!event.matches) closeWorkflow(false);
    }

    const observer = new MutationObserver(() => {
      tryOpenRequestedJob();
      const active = activeRef.current;
      if (!active) return;

      if (active.id === 'field-service') {
        const completed = Boolean(active.stage.querySelector(':scope > .success'));
        const stillExecuting = Boolean(active.detail.querySelector('.field-completion-form'));
        if (completed && !stillExecuting) closeWorkflow(false);
      }

      if (active.id === 'admin-access') {
        const deleted = Boolean(active.stage.querySelector(':scope > .success'));
        const emptyEditor = Boolean(active.detail.querySelector('.compact-empty-state'));
        if (deleted && emptyEditor) closeWorkflow(false);
      }
    });

    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('popstate', handlePopState);
    media.addEventListener('change', handleViewportChange);
    observer.observe(document.body, { childList: true, subtree: true });
    const requestedFrame = window.requestAnimationFrame(tryOpenRequestedJob);

    return () => {
      window.cancelAnimationFrame(requestedFrame);
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener('popstate', handlePopState);
      media.removeEventListener('change', handleViewportChange);
      observer.disconnect();
      closeWorkflow(false);
    };
  }, [closeWorkflow, openWorkflow, pathname]);

  if (!activeSummary) return null;

  return (
    <div aria-label={`${activeSummary.listLabel} detail navigation`} className="mobile-workflow-context-bar" role="region">
      <button className="mobile-workflow-back" onClick={requestClose} ref={backButtonRef} type="button">
        <span aria-hidden="true">←</span>
        <span>Back</span>
      </button>
      <div className="mobile-workflow-context-copy">
        <small>{activeSummary.listLabel}</small>
        <strong>{activeSummary.title}</strong>
      </div>
    </div>
  );
}
