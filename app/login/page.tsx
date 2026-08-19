'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { getDefaultPathForRole } from '@/lib/auth/permissions';
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet } from '@/lib/browserStorage';
import {
  getAuthRememberMePreference,
  getSupabaseClient,
  setAuthRememberMePreference,
} from '@/lib/supabase/client';
import { isProfileComplete } from '@/types/dallmayrerp';

const REMEMBERED_EMAIL_KEY = 'dallmayrerp-remembered-email';

export default function LoginPage() {
  const router = useRouter();
  const { authUser, businessUser, userDetails, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'activate'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const remembered = getAuthRememberMePreference();
    setRememberMe(remembered);
    if (remembered) setEmail(safeLocalStorageGet(REMEMBERED_EMAIL_KEY) ?? '');
  }, []);

  useEffect(() => {
    if (!loading && authUser && businessUser && userDetails) {
      router.replace(isProfileComplete(userDetails) ? getDefaultPathForRole(userDetails.role) : '/onboarding');
    }
  }, [authUser, businessUser, userDetails, loading, router]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      setAuthRememberMePreference(rememberMe);

      if (rememberMe) safeLocalStorageSet(REMEMBERED_EMAIL_KEY, cleanEmail);
      else safeLocalStorageRemove(REMEMBERED_EMAIL_KEY);

      const client = getSupabaseClient();
      const { error: loginError } = await client.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (loginError) {
        setError('Login failed. Check that your account is activated and that the password is correct.');
        return;
      }

      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login could not start.');
    } finally {
      setSubmitting(false);
    }
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const client = getSupabaseClient();
      const cleanEmail = email.trim().toLowerCase();
      const { error: signUpError } = await client.auth.signUp({
        email: cleanEmail,
        password,
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      const { error: loginError } = await client.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (loginError) {
        setSuccess('Account activation started. Check your email if Supabase requires confirmation, then sign in. Your email must still be invited by an administrator before telemetry access unlocks.');
        setMode('login');
        return;
      }

      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account activation could not start.');
    } finally {
      setSubmitting(false);
    }
  }

  const isActivate = mode === 'activate';

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
        <div className="orb" />
        <div className="badge">Secure workspace</div>
        <h1>{isActivate ? 'Activate your Dallmayr Telemetry account' : 'Sign in'}</h1>
        <p>
          {isActivate
            ? 'Create your secure login account. Access unlocks after an administrator has invited the same email address.'
            : 'Use your Supabase Auth account to open the machine and telemetry workspace.'}
        </p>
        {error ? <div className="error" role="alert">{error}</div> : null}
        {success ? <div aria-live="polite" className="success" role="status">{success}</div> : null}
        <form onSubmit={isActivate ? activate : login} className="grid" style={{ marginTop: 20 }}>
          <label>
            Email
            <input autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input autoComplete={isActivate ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} required />
          </label>
          {!isActivate ? (
            <label className="login-remember-me">
              <input
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Remember me on this device</strong>
                <small>Stay signed in on this device until you choose Sign out. Your password is never stored by Dallmayr Telemetry.</small>
              </span>
            </label>
          ) : null}
          <button className="button pulse-button" disabled={submitting} type="submit">
            {submitting ? 'Please wait...' : isActivate ? 'Activate account' : 'Sign in'}
          </button>
        </form>
        <div className="action-row">
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setMode(isActivate ? 'login' : 'activate');
              setError(null);
              setSuccess(null);
            }}
          >
            {isActivate ? 'I already have an account' : 'First login? Activate account'}
          </button>
        </div>
      </div>
    </main>
  );
}
