'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { getDefaultPathForRole } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isProfileComplete } from '@/types/dallmayrerp';

export default function LoginPage() {
  const router = useRouter();
  const { authUser, businessUser, userDetails, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'activate'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

    const client = getSupabaseClient();
    const cleanEmail = email.trim().toLowerCase();
    const { error: loginError } = await client.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    setSubmitting(false);

    if (loginError) {
      setError('Login failed. Check that your account is activated and that the password is correct.');
      return;
    }

    router.replace('/');
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const client = getSupabaseClient();
    const cleanEmail = email.trim().toLowerCase();

    const { error: signUpError } = await client.auth.signUp({
      email: cleanEmail,
      password,
    });

    if (signUpError) {
      setSubmitting(false);
      setError(signUpError.message);
      return;
    }

    const { error: loginError } = await client.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    setSubmitting(false);

    if (loginError) {
      setSuccess('Account activation started. Check your email if Supabase requires confirmation, then sign in. Your email must still be invited by admin before ERP access unlocks.');
      setMode('login');
      return;
    }

    router.replace('/');
  }

  const isActivate = mode === 'activate';

  return (
    <main className="login-page">
      <div className="login-card neo-card">
        <div className="orb" />
        <div className="badge">Secure ERP</div>
        <h1>{isActivate ? 'Activate your DallmayrERP account' : 'DallmayrERP Sign In'}</h1>
        <p>
          {isActivate
            ? 'Create your Supabase login account. ERP access only unlocks when admin has invited the same email in Users & Roles.'
            : 'Use your Supabase Auth account. New users complete their personal profile once before their role workspace unlocks.'}
        </p>
        {error ? <div className="error">{error}</div> : null}
        {success ? <div className="success">{success}</div> : null}
        <form onSubmit={isActivate ? activate : login} className="grid" style={{ marginTop: 20 }}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} required />
          </label>
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
