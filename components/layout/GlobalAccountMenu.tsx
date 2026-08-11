'use client';

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ACCENT_PRESETS,
  CURATED_APPEARANCE_THEMES,
  useAppearance,
} from '@/components/appearance/AppearanceProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName } from '@/types/dallmayrerp';

function initialsFor(name: string) {
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return initials || 'U';
}

export function GlobalAccountMenu() {
  const { authUser, businessProfile, userDetails, loading } = useAuth();
  const { preferences, status: appearanceStatus, error: appearanceError, updatePreferences, resetPreferences } = useAppearance();
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [mobilePlacement, setMobilePlacement] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !authUser) {
      setPortalTarget(null);
      setMobilePlacement(false);
      return;
    }

    const mobileMedia = window.matchMedia('(max-width: 980px)');
    function syncTarget() {
      const sidebarTarget = document.querySelector('.dallmayr-sidebar-account-menu-target');
      const headerTarget = document.querySelector('.desktop-account-menu-target');
      const legacyTarget = document.querySelector('.erp-menu-row.notch-menu-row');
      const mobileTarget = document.querySelector('#mobile-account-menu-target');
      const useMobile = mobileMedia.matches && Boolean(mobileTarget);
      setMobilePlacement(useMobile);
      setPortalTarget(useMobile ? mobileTarget : sidebarTarget ?? headerTarget ?? legacyTarget ?? mobileTarget);
    }

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    mobileMedia.addEventListener('change', syncTarget);
    return () => {
      observer.disconnect();
      mobileMedia.removeEventListener('change', syncTarget);
    };
  }, [authUser, loading]);

  useEffect(() => {
    function closeOpenMenus(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.dallmayr-account-menu')) return;
      document.querySelectorAll<HTMLDetailsElement>('.dallmayr-account-menu[open]').forEach((menu) => { menu.open = false; });
      setSettingsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      document.querySelectorAll<HTMLDetailsElement>('.dallmayr-account-menu[open]').forEach((menu) => { menu.open = false; });
      setSettingsOpen(false);
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
  if (loading || !authUser || !businessProfile || !userDetails || !portalTarget) return null;

  const userEmail = businessProfile.user.email;
  const roleLabel = roleLabels[userDetails.role];
  const selectedTheme = CURATED_APPEARANCE_THEMES.find((theme) => theme.themeTone === preferences.themeTone) ?? CURATED_APPEARANCE_THEMES[0];
  const selectedAccent = ACCENT_PRESETS.find((accent) => accent.value.toLowerCase() === preferences.accentColor.toLowerCase());
  const appearanceStatusText = appearanceStatus === 'loading'
    ? 'Loading your saved settings…'
    : appearanceStatus === 'saving'
      ? 'Saving settings…'
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
      setSigningOut(false);
      window.alert('Sign out failed. Please try again.');
      return;
    }
    window.location.replace('/login');
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordBusy) return;
    setPasswordMessage(null);
    setPasswordError(null);
    if (!currentPassword) return setPasswordError('Enter your current password.');
    if (newPassword.length < 8) return setPasswordError('Your new password must contain at least 8 characters.');
    if (newPassword !== confirmPassword) return setPasswordError('The new passwords do not match.');
    if (newPassword === currentPassword) return setPasswordError('Choose a new password that is different from your current password.');
    if (!userEmail) return setPasswordError('Your account email could not be resolved. Sign out and sign in again.');

    setPasswordBusy(true);
    try {
      const supabase = getSupabaseClient();
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: userEmail, password: currentPassword });
      if (verifyError) return setPasswordError('Your current password is incorrect.');
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) return setPasswordError(updateError.message || 'Your password could not be changed.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password changed successfully.');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Your password could not be changed.');
    } finally {
      setPasswordBusy(false);
    }
  }

  return createPortal(
    <details className={`dallmayr-account-menu ${mobilePlacement ? 'is-mobile' : 'is-sidebar'}`}>
      <summary aria-label={`Open account menu for ${userName}`} className="dallmayr-account-trigger">
        <span aria-hidden="true" className="dallmayr-account-avatar">{mobilePlacement ? userInitials : roleLabel.slice(0, 1).toUpperCase()}</span>
        <span className="dallmayr-account-identity">
          {mobilePlacement ? (
            <><strong>{userName}</strong><small>{roleLabel}</small></>
          ) : (
            <><small>Signed in as</small><strong>{roleLabel}</strong><small>Active ERP account</small></>
          )}
        </span>
        <span aria-hidden="true" className="dallmayr-account-chevron">▾</span>
      </summary>

      <div className={`dallmayr-account-panel ${settingsOpen ? 'is-customizing' : 'is-compact'}`}>
        <button
          aria-expanded={settingsOpen}
          className="dallmayr-account-appearance-toggle"
          onClick={() => setSettingsOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden="true">⚙</span>
          <span><strong>Settings</strong><small>Theme, accent colour and password</small></span>
          <span aria-hidden="true">{settingsOpen ? '−' : '›'}</span>
        </button>

        {settingsOpen ? (
          <section aria-label="Personal settings" className="appearance-editor">
            <div className="appearance-editor-heading">
              <div><strong>Personal settings</strong><small>These changes apply only to your account.</small></div>
              <span className={`appearance-save-state is-${appearanceStatus}`}>{appearanceStatusText}</span>
            </div>

            <div aria-label="Available visual themes" className="appearance-theme-choice-grid" role="group">
              {CURATED_APPEARANCE_THEMES.map((theme) => {
                const active = preferences.themeTone === theme.themeTone;
                return (
                  <button aria-pressed={active} className={`appearance-theme-choice ${active ? 'is-active' : ''}`} key={theme.id} onClick={() => updatePreferences({ themeTone: theme.themeTone })} type="button">
                    <span aria-hidden="true" className="appearance-theme-preview">
                      <span style={{ backgroundColor: theme.preview[0] }} /><span style={{ backgroundColor: theme.preview[1] }} /><span style={{ backgroundColor: theme.preview[2] }} />
                    </span>
                    <span className="appearance-theme-copy"><span className="appearance-theme-title-row"><strong>{theme.name}</strong><small>{theme.modeLabel}</small></span><span>{theme.description}</span></span>
                    <span aria-hidden="true" className="appearance-theme-check">{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              <div><strong>Accent colour</strong><small style={{ display: 'block' }}>Used for highlights, actions and focus states.</small></div>
              <div aria-label="Accent colour presets" role="group" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {ACCENT_PRESETS.map((accent) => {
                  const active = accent.value.toLowerCase() === preferences.accentColor.toLowerCase();
                  return (
                    <button aria-pressed={active} key={accent.value} onClick={() => updatePreferences({ accentColor: accent.value })} style={{ minHeight: 48, border: active ? '2px solid var(--focus-contrast)' : '1px solid var(--content-border)', borderRadius: 10, background: 'var(--content-surface)', display: 'grid', placeItems: 'center', gap: 4, padding: 6 }} type="button">
                      <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: accent.value, border: '1px solid rgba(0,0,0,.18)' }} /><small>{accent.name}</small>
                    </button>
                  );
                })}
              </div>
              <label style={{ display: 'grid', gridTemplateColumns: '56px minmax(0, 1fr)', alignItems: 'center', gap: 10 }}>
                <input aria-label="Custom accent colour" onChange={(event) => updatePreferences({ accentColor: event.target.value })} style={{ width: 52, height: 44, padding: 2 }} type="color" value={preferences.accentColor} />
                <span><strong>Custom colour</strong><small style={{ display: 'block' }}>{preferences.accentColor.toUpperCase()}</small></span>
              </label>
              <small>{selectedTheme.name} · {selectedAccent?.name ?? 'Custom accent'}</small>
            </div>

            {appearanceError ? <div className="appearance-sync-error" role="alert">{appearanceError}</div> : null}
            <div className="appearance-editor-actions"><button className="appearance-reset" onClick={resetPreferences} type="button">Reset appearance</button></div>

            <form onSubmit={changePassword} style={{ display: 'grid', gap: 10, marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--content-border)' }}>
              <div><strong>Change password</strong><small style={{ display: 'block' }}>Confirm your current password before choosing a new one.</small></div>
              <label><span>Current password</span><input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
              <label><span>New password</span><input autoComplete="new-password" minLength={8} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
              <label><span>Confirm new password</span><input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
              {passwordError ? <div className="appearance-sync-error" role="alert">{passwordError}</div> : null}
              {passwordMessage ? <div role="status" style={{ color: 'var(--content-accent-text)', fontWeight: 700 }}>{passwordMessage}</div> : null}
              <button className="appearance-reset" disabled={passwordBusy} type="submit">{passwordBusy ? 'Changing password…' : 'Change password'}</button>
            </form>
          </section>
        ) : null}

        <button className="dallmayr-account-signout" disabled={signingOut} onClick={signOut} type="button">
          <span aria-hidden="true">↪</span> {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </details>,
    portalTarget,
  );
}
