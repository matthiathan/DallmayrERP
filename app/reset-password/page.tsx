'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const { authUser, loading } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [checkingLink, setCheckingLink] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function resolveRecoverySession() {
      try {
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) {
          const { error: exchangeError } = await getSupabaseClient().auth.exchangeCodeForSession(code);
          if (exchangeError && active) setError('This password-reset link is invalid or has expired. Request a new link.');
        }
      } catch {
        if (active) setError('This password-reset link could not be verified. Request a new link.');
      } finally {
        if (active) setCheckingLink(false);
      }
    }

    void resolveRecoverySession();
    return () => { active = false; };
  }, []);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 8) return setError('Your new password must contain at least 8 characters.');
    if (newPassword !== confirmPassword) return setError('The passwords do not match.');

    setSubmitting(true);
    try {
      const { error: updateError } = await getSupabaseClient().auth.updateUser({ password: newPassword });
      if (updateError) return setError(updateError.message || 'Your password could not be changed.');
      setNewPassword('');
      setConfirmPassword('');
      setComplete(true);
    } catch (updateFailure) {
      setError(updateFailure instanceof Error ? updateFailure.message : 'Your password could not be changed.');
    } finally {
      setSubmitting(false);
    }
  }

  const sessionReady = Boolean(authUser) && !checkingLink && !loading;

  return (
    <main className="login-page dynamics-login-page">
      <section aria-label="Dallmayr Machine Telemetry security" className="dynamics-login-intro">
        <div className="dynamics-login-brand"><span aria-hidden="true">D</span><strong>Dallmayr Telemetry</strong></div>
        <div className="dynamics-login-copy">
          <span>Account security</span>
          <h1>Choose a new password for your telemetry account.</h1>
          <p>Your recovery link creates a temporary secure session. Once saved, the new password takes effect immediately.</p>
        </div>
        <div className="dynamics-login-modules" aria-label="Security features">
          <span>Encrypted</span><span>Private</span><span>Secure</span><span>Verified</span>
        </div>
      </section>

      <div className="login-card neo-card dynamics-login-card">
        <div className="badge">Password recovery</div>
        <h1>{complete ? 'Password changed' : 'Set a new password'}</h1>
        <p>{complete ? 'Your account is secure and ready to use.' : 'Use at least 8 characters and choose a password you do not use elsewhere.'}</p>
        {error ? <div className="error" role="alert">{error}</div> : null}

        {complete ? (
          <div className="action-row"><Link className="button pulse-button" href="/">Continue to telemetry</Link></div>
        ) : sessionReady ? (
          <form className="grid" onSubmit={updatePassword}>
            <label>
              New password
              <input autoComplete="new-password" minLength={8} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} />
            </label>
            <label>
              Confirm new password
              <input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
            </label>
            <button className="button pulse-button" disabled={submitting} type="submit">{submitting ? 'Changing password…' : 'Change password'}</button>
          </form>
        ) : checkingLink || loading ? (
          <div aria-live="polite" className="success" role="status">Verifying your secure reset link…</div>
        ) : (
          <div className="action-row"><Link className="button secondary" href="/login">Request a new reset link</Link></div>
        )}
      </div>
    </main>
  );
}
