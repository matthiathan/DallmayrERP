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
    <section className="page-toolbar" aria-label={`${title} controls`}>
      <div className="page-toolbar-heading">
        <div>
          <div className="nav-heading">Workspace controls</div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {lastUpdated ? <span className="page-toolbar-updated">Updated {lastUpdated.toLocaleTimeString()}</span> : null}
      </div>

      {hasControls ? (
        <details
          className="page-toolbar-controls-disclosure"
          onToggle={(event) => {
            if (isMobile) setControlsOpen(event.currentTarget.open);
          }}
          open={!isMobile || controlsOpen}
        >
          <summary>
            <span>Filters and actions</span>
          </summary>
          <div className="page-toolbar-controls-body">
            {children ? <div className="page-toolbar-filters">{children}</div> : null}
            {actions ? <div className="page-toolbar-actions">{actions}</div> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
