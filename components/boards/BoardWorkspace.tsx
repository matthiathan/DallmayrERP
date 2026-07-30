'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

type BoardView = {
  id: string;
  label: string;
  count?: number;
};

export function BoardHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="monday-board-header">
      <div className="monday-board-header-copy">
        {eyebrow ? <span className="monday-board-eyebrow">{eyebrow}</span> : null}
        <div className="monday-board-title-row">
          <h1>{title}</h1>
          {meta ? <div className="monday-board-header-meta">{meta}</div> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="monday-board-header-actions">{actions}</div> : null}
    </header>
  );
}

export function BoardViewTabs({
  views,
  activeId,
  onChange,
}: {
  views: BoardView[];
  activeId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div aria-label="Board views" className="monday-board-view-tabs" role="tablist">
      {views.map((view) => (
        <button
          aria-selected={activeId === view.id}
          className="monday-board-view-tab"
          key={view.id}
          onClick={() => onChange(view.id)}
          role="tab"
          type="button"
        >
          <span>{view.label}</span>
          {typeof view.count === 'number' ? <small>{view.count.toLocaleString()}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function BoardCommandBar({ children }: { children: ReactNode }) {
  return <div className="monday-board-command-bar">{children}</div>;
}

export function BoardFilterChips({ children }: { children: ReactNode }) {
  return <div className="monday-board-filter-chips">{children}</div>;
}

export function BoardFilterDrawer({
  open,
  title,
  description,
  children,
  footer,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])');
    focusable?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="monday-board-drawer-layer">
      <button aria-label="Close filters" className="monday-board-drawer-backdrop" onClick={onClose} type="button" />
      <aside aria-describedby={description ? 'monday-board-drawer-description' : undefined} aria-labelledby="monday-board-drawer-title" aria-modal="true" className="monday-board-filter-drawer" ref={panelRef} role="dialog">
        <header>
          <div>
            <span>Board controls</span>
            <h2 id="monday-board-drawer-title">{title}</h2>
            {description ? <p id="monday-board-drawer-description">{description}</p> : null}
          </div>
          <button aria-label="Close filters" className="monday-board-icon-button" onClick={onClose} type="button">×</button>
        </header>
        <div className="monday-board-filter-drawer-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </aside>
    </div>
  );
}

export function BoardGroupHeader({
  label,
  count,
  colSpan,
}: {
  label: string;
  count: number;
  colSpan: number;
}) {
  return (
    <tr className="monday-board-group-row">
      <td colSpan={colSpan}>
        <span>{label}</span>
        <small>{count.toLocaleString()} visible</small>
      </td>
    </tr>
  );
}
