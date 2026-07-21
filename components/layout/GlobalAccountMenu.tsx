'use client';

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName } from '@/types/dallmayrerp';

function initialsFor(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return initials || 'U';
}

export function GlobalAccountMenu() {
  const { authUser, businessProfile, userDetails, loading } = useAuth();
  const [brandTarget, setBrandTarget] = useState<Element | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (loading || !authUser) {
      setBrandTarget(null);
      return;
    }

    function syncTarget() {
      setBrandTarget(document.querySelector('.erp-menu-row.notch-menu-row'));
    }

    syncTarget();

    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [authUser, loading]);

  useEffect(() => {
    function closeOpenMenus(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.dallmayr-account-menu')) return;

      document
        .querySelectorAll<HTMLDetailsElement>('.dallmayr-account-menu[open]')
        .forEach((menu) => {
          menu.open = false;
        });
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      document
        .querySelectorAll<HTMLDetailsElement>('.dallmayr-account-menu[open]')
        .forEach((menu) => {
          menu.open = false;
        });
    }

    document.addEventListener('click', closeOpenMenus);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('click', closeOpenMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const userName = displayProfileName(businessProfile);
  const userInitials = useMemo(() => initialsFor(userName), [userName]);

  if (loading || !authUser || !businessProfile || !userDetails || !brandTarget) return null;

  const userEmail = businessProfile.user.email;
  const roleLabel = roleLabels[userDetails.role];
  const branchLabel = userDetails.branch.toUpperCase();

  async function signOut() {
    if (signingOut) return;

    setSigningOut(true);
    const { error } = await getSupabaseClient().auth.signOut();

    if (error) {
      console.error('Could not sign out of DallmayrERP.', error);
      setSigningOut(false);
      window.alert('Sign out failed. Please try again.');
      return;
    }

    window.location.replace('/login');
  }

  return createPortal(
    <details className="dallmayr-account-menu is-brand">
      <summary
        aria-label={`Open account menu for ${userName}`}
        className="dallmayr-account-trigger"
      >
        <span aria-hidden="true" className="dallmayr-account-avatar">{userInitials}</span>
        <span className="dallmayr-account-identity">
          <strong>{userName}</strong>
          <small>{roleLabel}</small>
        </span>
        <span aria-hidden="true" className="dallmayr-account-chevron">▾</span>
      </summary>

      <div className="dallmayr-account-panel">
        <div className="dallmayr-account-meta">
          <strong>{userName}</strong>
          <span>{userEmail}</span>
          <small>{roleLabel} · {branchLabel}</small>
        </div>
        <button
          className="dallmayr-account-signout"
          disabled={signingOut}
          onClick={signOut}
          type="button"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </details>,
    brandTarget,
  );
}
