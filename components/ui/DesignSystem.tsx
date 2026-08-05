import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function UiButton({ className, size = 'md', tone = 'primary', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: Size; tone?: ButtonTone }) {
  return <button className={cx('ui-button', className)} data-size={size} data-tone={tone} type={type} {...props} />;
}

export function UiBadge({ children, className, tone = 'neutral' }: { children: ReactNode; className?: string; tone?: Tone }) {
  return <span className={cx('ui-badge', className)} data-tone={tone}>{children}</span>;
}

export function UiCard({ children, className, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={cx('ui-card', className)} {...props}>{children}</section>;
}

export function UiField({ children, className, error, hint, label, required }: { children: ReactNode; className?: string; error?: ReactNode; hint?: ReactNode; label: ReactNode; required?: boolean }) {
  return <label className={cx('ui-field', className)}><span className="ui-field-label">{label}{required ? <span aria-hidden="true"> *</span> : null}</span>{children}{error ? <span className="ui-field-error" role="alert">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}</label>;
}

export function UiInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('ui-control', className)} {...props} />;
}

export function UiSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('ui-control', className)} {...props} />;
}

export function UiTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('ui-control', className)} {...props} />;
}

export function UiEmptyState({ action, description, icon = '—', title }: { action?: ReactNode; description: ReactNode; icon?: ReactNode; title: ReactNode }) {
  return <section className="ui-empty-state" role="status"><span className="ui-empty-state-icon" aria-hidden="true">{icon}</span><h2>{title}</h2><p>{description}</p>{action ? <div className="ui-empty-state-action">{action}</div> : null}</section>;
}

export function UiSkeleton({ className, lines = 1 }: { className?: string; lines?: number }) {
  return <div aria-busy="true" aria-label="Loading" className={cx('ui-skeleton', className)}>{Array.from({ length: lines }, (_, index) => <span key={index} />)}</div>;
}

export function UiDivider({ label }: { label?: ReactNode }) {
  return <div className="ui-divider" role="separator">{label ? <span>{label}</span> : null}</div>;
}
