'use client';

import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

type BackgroundState = {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
};

type AccessibleDialogProps = {
  open: boolean;
  onClose: () => void;
  id: string;
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
  className?: string;
  overlayClassName?: string;
  closeOnBackdrop?: boolean;
  children: ReactNode;
};

function visibleFocusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
    element.getAttribute('aria-hidden') !== 'true'
    && !element.hasAttribute('inert')
    && element.getClientRects().length > 0
  ));
}

export function AccessibleDialog({
  open,
  onClose,
  id,
  labelledBy,
  describedBy,
  ariaLabel,
  className = '',
  overlayClassName = '',
  closeOnBackdrop = true,
  children,
}: AccessibleDialogProps) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      setPortalRoot(null);
      return;
    }

    const root = document.createElement('div');
    root.dataset.dallmayrDialogPortal = 'true';
    document.body.appendChild(root);
    setPortalRoot(root);

    return () => {
      root.remove();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !portalRoot) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const backgroundStates: BackgroundState[] = Array.from(document.body.children)
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement
        && element !== portalRoot
        && element.tagName !== 'SCRIPT'
      ))
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute('aria-hidden'),
      }));

    for (const { element } of backgroundStates) {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const requestedFocus = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
      const firstFocusable = visibleFocusableElements(dialog)[0];
      (requestedFocus ?? firstFocusable ?? dialog).focus();
    });

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = visibleFocusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!dialogRef.current.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleDialogKeyDown);

      for (const { element, inert, ariaHidden } of backgroundStates) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      }

      const restoreTarget = restoreFocusRef.current;
      window.requestAnimationFrame(() => restoreTarget?.focus());
    };
  }, [open, portalRoot]);

  if (!open || !portalRoot) return null;

  return createPortal(
    <div
      className={`accessible-dialog-overlay ${overlayClassName}`.trim()}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.currentTarget === event.target) onCloseRef.current();
      }}
      role="presentation"
    >
      <section
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`accessible-dialog-panel ${className}`.trim()}
        id={id}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </section>
    </div>,
    portalRoot,
  );
}
