'use client';

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  CURATED_APPEARANCE_THEMES,
  useAppearance,
} from '@/components/appearance/AppearanceProvider';
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
  const {
    preferences,
    status: appearanceStatus,
    error: appearanceError,
    updatePreferences,
    resetPreferences,
  } = useAppearance();
  const [brandTarget, setBrandTarget] = useState<Element | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

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
      setAppearanceOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      document
        .querySelectorAll<HTMLDetailsElement>('.dallmayr-account-menu[open]')
        .forEach((menu) => {
          menu.open = false;
        });
      setAppearanceOpen(false);
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
  const selectedTheme = CURATED_APPEARANCE_THEMES.find(
    (theme) => theme.themeTone === preferences.themeTone,
  ) ?? CURATED_APPEARANCE_THEMES[0];
  const appearanceStatusText = appearanceStatus === 'loading'
    ? 'Loading your saved theme…'
    : appearanceStatus === 'saving'
      ? 'Saving theme…'
      : appearanceStatus === 'saved'
        ? 'Saved for your account'
        : appearanceStatus === 'error'
          ? 'Saved locally; cloud sync needs attention'
          : 'Theme changes preview instantly';

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

      <div className={`dallmayr-account-panel ${appearanceOpen ? 'is-customizing' : ''}`}>
        <div className="dallmayr-account-meta">
          <strong>{userName}</strong>
          <span>{userEmail}</span>
          <small>{roleLabel} · {branchLabel}</small>
        </div>

        <button
          aria-expanded={appearanceOpen}
          className="dallmayr-account-appearance-toggle"
          onClick={() => setAppearanceOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden="true">◐</span>
          <span>
            <strong>Visual theme</strong>
            <small>{selectedTheme.name} · {selectedTheme.modeLabel}</small>
          </span>
          <span aria-hidden="true">{appearanceOpen ? '−' : '+'}</span>
        </button>

        {appearanceOpen ? (
          <section aria-label="Visual theme selection" className="appearance-editor">
            <div className="appearance-editor-heading">
              <div>
                <strong>Choose your workspace</strong>
                <small>Both themes use fixed, high-contrast surface and text pairs on every page.</small>
              </div>
              <span className={`appearance-save-state is-${appearanceStatus}`}>{appearanceStatusText}</span>
            </div>

            <div aria-label="Available visual themes" className="appearance-theme-choice-grid" role="group">
              {CURATED_APPEARANCE_THEMES.map((theme) => {
                const active = preferences.themeTone === theme.themeTone;

                return (
                  <button
                    aria-pressed={active}
                    className={`appearance-theme-choice ${active ? 'is-active' : ''}`}
                    key={theme.id}
                    onClick={() => updatePreferences({ themeTone: theme.themeTone })}
                    type="button"
                  >
                    <span aria-hidden="true" className="appearance-theme-preview">
                      <span style={{ backgroundColor: theme.preview[0] }} />
                      <span style={{ backgroundColor: theme.preview[1] }} />
                      <span style={{ backgroundColor: theme.preview[2] }} />
                    </span>
                    <span className="appearance-theme-copy">
                      <span className="appearance-theme-title-row">
                        <strong>{theme.name}</strong>
                        <small>{theme.modeLabel}</small>
                      </span>
                      <span>{theme.description}</span>
                    </span>
                    <span aria-hidden="true" className="appearance-theme-check">{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>

            <p className="appearance-theme-note">
              Theme colours are curated rather than freely combined, preventing dark text on dark panels or light text on light panels.
            </p>

            {appearanceError ? <div className="appearance-sync-error" role="alert">{appearanceError}</div> : null}

            <div className="appearance-editor-actions">
              <button className="appearance-reset" onClick={resetPreferences} type="button">
                Use Slate Modern
              </button>
            </div>
          </section>
        ) : null}

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
