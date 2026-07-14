'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { getDefaultPathForRole } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const { authUser, businessUser, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && authUser && businessUser) {
      router.replace(businessUser.onboarding_required ? '/onboarding' : getDefaultPathForRole(businessUser.role));
    }
  }, [authUser, businessUser, loading, router]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const client = getSupabaseClient();
    const { error: loginError } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setSubmitting(false);

    if (loginError) {
      setError('Login failed. Check that this user exists in Supabase Auth and that the password is correct.');
      return;
    }

    router.replace('/');
  }

  return (
    <main className="login-page">
      <div className="login-card neo-card">
        <div className="orb" />
        <div className="badge">Secure ERP</div>
        <h1>DallmayrERP Sign In</h1>
        <p>Use your Supabase Auth account. New users complete their personal profile once before their role workspace unlocks.</p>
        {error ? <div className="error">{error}</div> : null}
        <form onSubmit={login} className="grid" style={{ marginTop: 20 }}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </label>
          <button className="button pulse-button" disabled={submitting} type="submit">
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
