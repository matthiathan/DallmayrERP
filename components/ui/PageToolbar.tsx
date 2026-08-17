'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ErpCommandBar, ErpSectionHeader } from '@/components/ui/ErpLayout';

const MOBILE_QUERY = '(max-width: 760px)';

export function PageToolbar({
  title,
  description,
  children,
  actions,
  lastUpdated,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  lastUpdated?: Date | null;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const hasControls = Boolean(children || actions);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isMobile) setControlsOpen(false);
  }, [isMobile]);

  const updatedTime = lastUpdated ? (
    <time className="page-toolbar-updated" dateTime={lastUpdated.toISOString()}>
      Updated {lastUpdated.toLocaleTimeString()}
    </time>
  ) : null;

  return (
    <ErpCommandBar
      ariaLabel={`${title} controls`}
      className="page-toolbar workspace-command-bar"
      hasControls={hasControls}
    >
      <ErpSectionHeader
        className="page-toolbar-heading workspace-command-heading"
        description={description}
        eyebrow="Workspace"
        meta={updatedTime}
        title={title}
      />

      {hasControls ? (
        <details
          className="page-toolbar-controls-disclosure workspace-command-controls"
          onToggle={(event) => {
            if (isMobile) setControlsOpen(event.currentTarget.open);
          }}
          open={!isMobile || controlsOpen}
        >
          <summary>
            <span>Filters and actions</span>
            <small>Refine this workspace</small>
          </summary>
          <div className="page-toolbar-controls-body workspace-command-body ds-command-bar__body">
            {children ? <div className="page-toolbar-filters workspace-filter-bar ds-filter-bar">{children}</div> : null}
            {actions ? <div className="page-toolbar-actions workspace-command-actions ds-action-bar">{actions}</div> : null}
          </div>
        </details>
      ) : null}
    </ErpCommandBar>
  );
}
