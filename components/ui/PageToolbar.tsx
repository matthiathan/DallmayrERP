'use client';

import type { ReactNode } from 'react';

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
      {children ? <div className="page-toolbar-filters">{children}</div> : null}
      {actions ? <div className="page-toolbar-actions">{actions}</div> : null}
    </section>
  );
}
