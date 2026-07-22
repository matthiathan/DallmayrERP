'use client';

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ACCENT_PRESETS,
  THEME_PRESETS,
  useAppearance,
} from '@/components/appearance/AppearanceProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName } from '@/types/dallmayrerp';

const BACKGROUND_PRESETS = [
  { name: 'Charcoal', value: '#0d0905' },
  { name: 'Midnight', value: '#081224' },
  { name: 'Forest', value: '#07150f' },
  { name: 'Plum', value: '#180b1f' },
  { name: 'Cloud', value: '#edf2f7' },
  { name: 'Sand', value: '#eee3d2' },
] as const;

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

function swatchStyle(color: string) {
  return { '--swatch-color': color } as CSSProperties;
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
  const appearanceStatusText = appearanceStatus === 'loading'
    ? 'Loading your saved look…'
    : appearanceStatus === 'saving'
      ? 'Saving changes…'
      : appearanceStatus === 'saved'
        ? 'Saved for your account'
        : appearanceStatus === 'error'
          ? 'Saved locally; cloud sync needs attention'
          : 'Changes preview instantly';

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
          <span aria-hidden="true">✦</span>
          <span>
            <strong>Customize appearance</strong>
            <small>Accent, theme and background</small>
          </span>
          <span aria-hidden="true">{appearanceOpen ? '−' : '+'}</span>
        </button>

        {appearanceOpen ? (
          <section aria-label="Appearance customization" className="appearance-editor">
            <div className="appearance-editor-heading">
              <div>
                <strong>Make DallmayrERP yours</strong>
                <small>Every change previews immediately.</small>
              </div>
              <span className={`appearance-save-state is-${appearanceStatus}`}>{appearanceStatusText}</span>
            </div>

            <div className="appearance-control">
              <label htmlFor="appearance-accent-color">
                <span>Accent colour</span>
                <small>Buttons, navigation, focus, table highlights and decorative details</small>
              </label>
              <div className="appearance-color-input-row">
                <input
                  aria-label="Choose custom accent colour"
                  id="appearance-accent-color"
                  onChange={(event) => updatePreferences({ accentColor: event.target.value })}
                  type="color"
                  value={preferences.accentColor}
                />
                <code>{preferences.accentColor.toUpperCase()}</code>
              </div>
              <div aria-label="Accent colour presets" className="appearance-swatches" role="group">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    aria-label={`Use ${preset.name} accent`}
                    aria-pressed={preferences.accentColor === preset.value}
                    className="appearance-swatch"
                    key={preset.value}
                    onClick={() => updatePreferences({ accentColor: preset.value })}
                    style={swatchStyle(preset.value)}
                    title={preset.name}
                    type="button"
                  />
                ))}
              </div>
            </div>

            <div className="appearance-control">
              <label htmlFor="appearance-theme-color">
                <span>Theme colour</span>
                <small>Panels, cards, forms, tables and navigation surfaces</small>
              </label>
              <div className="appearance-color-input-row">
                <input
                  aria-label="Choose custom theme colour"
                  id="appearance-theme-color"
                  onChange={(event) => updatePreferences({ themeColor: event.target.value })}
                  type="color"
                  value={preferences.themeColor}
                />
                <code>{preferences.themeColor.toUpperCase()}</code>
              </div>
              <div aria-label="Theme presets" className="appearance-theme-presets" role="group">
                {THEME_PRESETS.map((preset) => (
                  <button
                    aria-pressed={preferences.themeColor === preset.value && preferences.themeTone === preset.tone}
                    className="appearance-theme-preset"
                    key={preset.name}
                    onClick={() => updatePreferences({ themeColor: preset.value, themeTone: preset.tone })}
                    style={swatchStyle(preset.value)}
                    type="button"
                  >
                    <span aria-hidden="true" />
                    {preset.name}
                  </button>
                ))}
              </div>
              <div aria-label="Theme brightness" className="appearance-segmented" role="group">
                <button
                  aria-pressed={preferences.themeTone === 'dark'}
                  onClick={() => updatePreferences({ themeTone: 'dark' })}
                  type="button"
                >Dark</button>
                <button
                  aria-pressed={preferences.themeTone === 'light'}
                  onClick={() => updatePreferences({ themeTone: 'light' })}
                  type="button"
                >Light</button>
              </div>
            </div>

            <div className="appearance-control">
              <label htmlFor="appearance-background-color">
                <span>Background colour</span>
                <small>The base colour behind every workspace</small>
              </label>
              <div className="appearance-color-input-row">
                <input
                  aria-label="Choose custom background colour"
                  id="appearance-background-color"
                  onChange={(event) => updatePreferences({ backgroundColor: event.target.value })}
                  type="color"
                  value={preferences.backgroundColor}
                />
                <code>{preferences.backgroundColor.toUpperCase()}</code>
              </div>
              <div aria-label="Background colour presets" className="appearance-swatches" role="group">
                {BACKGROUND_PRESETS.map((preset) => (
                  <button
                    aria-label={`Use ${preset.name} background`}
                    aria-pressed={preferences.backgroundColor === preset.value}
                    className="appearance-swatch"
                    key={preset.value}
                    onClick={() => updatePreferences({ backgroundColor: preset.value })}
                    style={swatchStyle(preset.value)}
                    title={preset.name}
                    type="button"
                  />
                ))}
              </div>
              <label className="appearance-background-style" htmlFor="appearance-background-style">
                <span>Background effect</span>
                <select
                  id="appearance-background-style"
                  onChange={(event) => updatePreferences({
                    backgroundStyle: event.target.value as typeof preferences.backgroundStyle,
                  })}
                  value={preferences.backgroundStyle}
                >
                  <option value="aurora">Aurora glow</option>
                  <option value="mesh">Geometric mesh</option>
                  <option value="dots">Playful dots</option>
                  <option value="solid">Clean solid</option>
                </select>
              </label>
            </div>

            {appearanceError ? <div className="appearance-sync-error" role="alert">{appearanceError}</div> : null}

            <div className="appearance-editor-actions">
              <button className="appearance-reset" onClick={resetPreferences} type="button">Reset to Dallmayr default</button>
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
