import type { ReactNode } from 'react';

type SurfaceElement = 'div' | 'section' | 'article' | 'aside';
type HeadingLevel = 1 | 2 | 3;

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function WorkspaceSurface({
  as = 'section',
  children,
  className,
  ariaLabel,
  elevation = 'flat',
  padding = 'none',
}: {
  as?: SurfaceElement;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  elevation?: 'flat' | 'raised';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}) {
  const Component = as;

  return (
    <Component
      aria-label={ariaLabel}
      className={joinClasses('ds-surface', className)}
      data-elevation={elevation}
      data-padding={padding}
    >
      {children}
    </Component>
  );
}

export function WorkspaceSectionHeader({
  title,
  description,
  eyebrow,
  meta,
  actions,
  level = 2,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  level?: HeadingLevel;
  className?: string;
}) {
  const Heading = level === 1 ? 'h1' : level === 3 ? 'h3' : 'h2';

  return (
    <div className={joinClasses('ds-section-header', className)}>
      <div>
        {eyebrow ? <div className="nav-heading">{eyebrow}</div> : null}
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {meta || actions ? (
        <div className="ds-cluster" data-justify="between">
          {meta}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceCommandBar({
  children,
  className,
  ariaLabel,
  hasControls,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel: string;
  hasControls?: boolean;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className={joinClasses('ds-surface', 'ds-command-bar', className)}
      data-elevation="flat"
      data-has-controls={hasControls ? 'true' : 'false'}
      data-padding="none"
    >
      {children}
    </section>
  );
}
