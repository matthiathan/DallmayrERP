'use client';

import { FormEvent, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { error: loginError } = await getSupabaseClient().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setLoading(false);

    if (loginError) {
      setError('Login failed. Check that this user exists in Supabase Auth and that the password is correct.');
      return;
    }

    window.location.href = '/';
  }

  return (
    <main className="main" style={{ maxWidth: 460, margin: '80px auto' }}>
      <div className="card">
        <h1>DallmayrERP Sign In</h1>
        <p>Use your Supabase Auth account to access the ERP.</p>
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
          <button className="button" disabled={loading} type="submit">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
