'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet } from '@/lib/browserStorage';
import {
  getAuthRememberMePreference,
  getSupabaseClient,
  setAuthRememberMePreference,
} from '@/lib/supabase/client';

const REMEMBERED_EMAIL_KEY = 'dallmayrerp-remembered-email';
type LoginMode = 'login' | 'signup' | 'forgot';

function loginDestination() {
  const requested = new URLSearchParams(window.location.search).get('next');
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) return '/';
  try {
    const destination = new URL(requested, window.location.origin);
    if (destination.origin !== window.location.origin) return '/';
    if (destination.pathname.startsWith('/login') || destination.pathname.startsWith('/reset-password')) return '/';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/';
  }
}

function modeCopy(mode: LoginMode) {
  if (mode === 'signup') {
    return {
      title: 'Create your telemetry account',
      description: 'Create one secure account for the shared machine and telemetry workspace.',
      submit: 'Create account',
    };
  }
  if (mode === 'forgot') {
    return {
      title: 'Reset your password',
      description: 'Enter your email and we will send you a secure password-reset link.',
      submit: 'Send reset link',
    };
  }
  return {
    title: 'Sign in',
    description: 'Use your Dallmayr telemetry account to continue.',
    submit: 'Sign in',
  };
}

export default function LoginPage() {
  const router = useRouter();
  const { authUser, loading } = useAuth();
  const [mode, setMode] = useState<LoginMode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const copy = modeCopy(mode);

  useEffect(() => {
    const remembered = getAuthRememberMePreference();
    setRememberMe(remembered);
    if (remembered) setEmail(safeLocalStorageGet(REMEMBERED_EMAIL_KEY) ?? '');
  }, []);

  useEffect(() => {
    if (!loading && authUser) router.replace(loginDestination());
  }, [authUser, loading, router]);

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const client = getSupabaseClient();

      if (mode === 'forgot') {
        const { error: resetError } = await client.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) return setError(resetError.message || 'The password reset email could not be sent.');
        setSuccess('Check your email for the secure password-reset link.');
        return;
      }

      if (mode === 'signup') {
        const cleanName = fullName.trim();
        if (!cleanName) return setError('Enter your full name.');
        if (password.length < 8) return setError('Your password must contain at least 8 characters.');
        if (password !== confirmPassword) return setError('The passwords do not match.');

        const { data, error: signUpError } = await client.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { full_name: cleanName } },
        });
        if (signUpError) return setError(signUpError.message);
        if (data.session) {
          router.replace(loginDestination());
          return;
        }
        setSuccess('Account created. Check your email to confirm it, then sign in.');
        setMode('login');
        setPassword('');
        setConfirmPassword('');
        return;
      }

      setAuthRememberMePreference(rememberMe);
      if (rememberMe) safeLocalStorageSet(REMEMBERED_EMAIL_KEY, cleanEmail);
      else safeLocalStorageRemove(REMEMBERED_EMAIL_KEY);

      const { error: loginError } = await client.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (loginError) return setError('Sign in failed. Check your email and password, then try again.');
      router.replace(loginDestination());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication could not start.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page dynamics-login-page">
      <section aria-label="Dallmayr Machine Telemetry overview" className="dynamics-login-intro">
        <div className="dynamics-login-brand">
          <span aria-hidden="true">D</span>
          <strong>Dallmayr Telemetry</strong>
        </div>
        <div className="dynamics-login-copy">
          <span>Machine intelligence</span>
          <h1>See every machine, telemetry device, sale and fault in one place.</h1>
          <p>Live device health, flexible reporting schedules and actionable fleet monitoring for Dallmayr South Africa.</p>
        </div>
        <div className="dynamics-login-modules" aria-label="Core modules">
          <span>Machines</span>
          <span>Telemetry</span>
          <span>Faults</span>
          <span>Analytics</span>
        </div>
      </section>

      <div className="login-card neo-card dynamics-login-card">
        <div className="badge">Secure workspace</div>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        {error ? <div className="error" role="alert">{error}</div> : null}
        {success ? <div aria-live="polite" className="success" role="status">{success}</div> : null}

        <form className="grid" onSubmit={submit}>
          {mode === 'signup' ? (
            <label>
              Full name
              <input autoComplete="name" onChange={(event) => setFullName(event.target.value)} required value={fullName} />
            </label>
          ) : null}
          <label>
            Email
            <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          {mode !== 'forgot' ? (
            <label>
              Password
              <input autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
            </label>
          ) : null}
          {mode === 'signup' ? (
            <label>
              Confirm password
              <input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
            </label>
          ) : null}
          {mode === 'login' ? (
            <label className="login-remember-me">
              <input checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" />
              <span>
                <strong>Remember me on this device</strong>
                <small>Stay signed in until you choose Sign out. Your password is never stored by Dallmayr Telemetry.</small>
              </span>
            </label>
          ) : null}
          <button className="button pulse-button" disabled={submitting} type="submit">
            {submitting ? 'Please wait…' : copy.submit}
          </button>
        </form>

        <div className="action-row login-secondary-actions">
          {mode === 'login' ? (
            <>
              <button className="button secondary" onClick={() => switchMode('forgot')} type="button">Forgot password</button>
              <button className="button secondary" onClick={() => switchMode('signup')} type="button">Create account</button>
            </>
          ) : (
            <button className="button secondary" onClick={() => switchMode('login')} type="button">Back to sign in</button>
          )}
        </div>
      </div>
    </main>
  );
}
