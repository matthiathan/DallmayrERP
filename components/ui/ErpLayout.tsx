import type { ReactNode } from 'react';

type PageVariant = 'dashboard' | 'list' | 'record' | 'operational' | 'form' | 'default';
type PanelDensity = 'comfortable' | 'compact';
type PanelScroll = 'none' | 'content' | 'list';
type MetricTone = 'neutral' | 'good' | 'warning' | 'danger' | 'info';
type StateTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function ErpPage({ children, className, variant = 'default' }: { children: ReactNode; className?: string; variant?: PageVariant }) {
  return <div className={joinClasses('erp-page', className)} data-erp-page={variant}>{children}</div>;
}

export function ErpPageHeader({ actions, children, className, description, eyebrow, meta, title }: {
  actions?: ReactNode; children?: ReactNode; className?: string; description?: ReactNode; eyebrow?: ReactNode; meta?: ReactNode; title: ReactNode;
}) {
  return (
    <section className={joinClasses('erp-page-header', className)}>
      <div className="erp-page-header-copy">
        {eyebrow ? <span className="erp-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
        {children}
      </div>
      {meta || actions ? <div className="erp-page-header-side">{meta ? <div className="erp-page-header-meta">{meta}</div> : null}{actions ? <div className="erp-page-header-actions">{actions}</div> : null}</div> : null}
    </section>
  );
}

export function ErpToolbar({ children, className, primary, secondary }: { children?: ReactNode; className?: string; primary?: ReactNode; secondary?: ReactNode }) {
  return <div className={joinClasses('erp-toolbar', className)}><div className="erp-toolbar-primary">{primary ?? children}</div>{secondary ? <div className="erp-toolbar-secondary">{secondary}</div> : null}</div>;
}

export function ErpFilterBar({ actions, children, className, resultCount }: { actions?: ReactNode; children: ReactNode; className?: string; resultCount?: ReactNode }) {
  return <section className={joinClasses('erp-filter-bar', className)}><div className="erp-filter-controls">{children}</div>{resultCount || actions ? <div className="erp-filter-summary">{resultCount ? <span>{resultCount}</span> : null}{actions}</div> : null}</section>;
}

export function ErpPanel({ actions, children, className, density = 'comfortable', description, eyebrow, scroll = 'none', title }: {
  actions?: ReactNode; children: ReactNode; className?: string; density?: PanelDensity; description?: ReactNode; eyebrow?: ReactNode; scroll?: PanelScroll; title?: ReactNode;
}) {
  const hasHeader = Boolean(title || description || eyebrow || actions);
  return <section className={joinClasses('erp-panel', className)} data-density={density} data-scroll={scroll}>{hasHeader ? <header className="erp-panel-header"><div>{eyebrow ? <span className="erp-eyebrow">{eyebrow}</span> : null}{title ? <h2>{title}</h2> : null}{description ? <p>{description}</p> : null}</div>{actions ? <div className="erp-panel-actions">{actions}</div> : null}</header> : null}<div className="erp-panel-body">{children}</div></section>;
}

export function ErpContentGrid({ children, className, columns = 2 }: { children: ReactNode; className?: string; columns?: 1 | 2 | 3 }) {
  return <div className={joinClasses('erp-content-grid', className)} data-columns={columns}>{children}</div>;
}

export function ErpMetricGrid({ children, className, columns = 'auto' }: { children: ReactNode; className?: string; columns?: 'auto' | 2 | 3 | 4 }) {
  return <section className={joinClasses('erp-metric-grid', className)} data-columns={columns}>{children}</section>;
}

export function ErpMetricCard({ action, helper, label, tone = 'neutral', value }: { action?: ReactNode; helper?: ReactNode; label: ReactNode; tone?: MetricTone; value: ReactNode }) {
  return <article className="erp-metric-card" data-tone={tone}><div><span>{label}</span><strong>{value}</strong>{helper ? <p>{helper}</p> : null}</div>{action ? <div className="erp-metric-action">{action}</div> : null}</article>;
}

export function ErpTableShell({ children, className, footer, toolbar }: { children: ReactNode; className?: string; footer?: ReactNode; toolbar?: ReactNode }) {
  return <section className={joinClasses('erp-table-shell', className)}>{toolbar ? <div className="erp-table-toolbar">{toolbar}</div> : null}<div className="erp-table-scroll">{children}</div>{footer ? <footer className="erp-table-footer">{footer}</footer> : null}</section>;
}

export function ErpPagination({ children, className, summary }: { children: ReactNode; className?: string; summary?: ReactNode }) {
  return <nav aria-label="Pagination" className={joinClasses('erp-pagination', className)}>{summary ? <span>{summary}</span> : null}<div>{children}</div></nav>;
}

export function ErpSplitView({ aside, children, className, priority = 'primary' }: { aside: ReactNode; children: ReactNode; className?: string; priority?: 'primary' | 'aside' }) {
  return <div className={joinClasses('erp-split-view', className)} data-priority={priority}><div className="erp-split-primary">{children}</div><aside className="erp-split-aside">{aside}</aside></div>;
}

export function ErpRecordLayout({ children, className, summary }: { children: ReactNode; className?: string; summary?: ReactNode }) {
  return <div className={joinClasses('erp-record-layout', className)}>{summary ? <aside className="erp-record-summary">{summary}</aside> : null}<div className="erp-record-main">{children}</div></div>;
}

export function ErpRecordSummary({ children, className, title }: { children: ReactNode; className?: string; title?: ReactNode }) {
  return <section className={joinClasses('erp-record-summary-card', className)}>{title ? <h2>{title}</h2> : null}<dl>{children}</dl></section>;
}

export function ErpTabBar({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return <nav aria-label={label} className={joinClasses('erp-tab-bar', className)} role="tablist">{children}</nav>;
}

export function ErpStateBanner({ action, children, className, message, title, tone = 'info' }: { action?: ReactNode; children?: ReactNode; className?: string; message?: ReactNode; title: ReactNode; tone?: StateTone }) {
  return <section className={joinClasses('erp-state-banner', className)} data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}><div className="erp-state-marker" aria-hidden="true" /><div className="erp-state-copy"><h2>{title}</h2>{message ? <p>{message}</p> : null}{children}</div>{action ? <div className="erp-state-action">{action}</div> : null}</section>;
}

export function ErpFormSection({ actions, children, className, description, title }: { actions?: ReactNode; children: ReactNode; className?: string; description?: ReactNode; title?: ReactNode }) {
  return <section className={joinClasses('erp-form-section', className)}>{title || description ? <header className="erp-form-section-header">{title ? <h3>{title}</h3> : null}{description ? <p>{description}</p> : null}</header> : null}<div className="erp-form-section-body">{children}</div>{actions ? <div className="erp-form-section-actions">{actions}</div> : null}</section>;
}
