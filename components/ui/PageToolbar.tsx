'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

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

  return (
    <section
      aria-label={`${title} controls`}
      className="page-toolbar workspace-command-bar"
      data-has-controls={hasControls ? 'true' : 'false'}
    >
      <div className="page-toolbar-heading workspace-command-heading">
        <div>
          <div className="nav-heading">Workspace</div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {lastUpdated ? (
          <time className="page-toolbar-updated" dateTime={lastUpdated.toISOString()}>
            Updated {lastUpdated.toLocaleTimeString()}
          </time>
        ) : null}
      </div>

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
          <div className="page-toolbar-controls-body workspace-command-body">
            {children ? <div className="page-toolbar-filters workspace-filter-bar">{children}</div> : null}
            {actions ? <div className="page-toolbar-actions workspace-command-actions">{actions}</div> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
