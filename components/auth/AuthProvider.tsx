'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { BusinessUser } from '@/types/dallmayrerp';

type AuthContextValue = {
  authUser: User | null;
  businessUser: BusinessUser | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function stampLastLogin(profile: BusinessUser) {
  await getSupabaseClient()
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', profile.id);
}

async function loadBusinessProfile(authUser: User | null, markLogin = false): Promise<BusinessUser | null> {
  if (!authUser) return null;

  const client = getSupabaseClient();

  const byAuth = await client
    .from('users')
    .select('*')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (byAuth.error) {
    throw byAuth.error;
  }

  if (byAuth.data) {
    const profile = byAuth.data as BusinessUser;
    if (markLogin) await stampLastLogin(profile);
    return profile;
  }

  const email = authUser.email?.trim().toLowerCase();
  if (!email) return null;

  const byEmail = await client
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (byEmail.error) {
    throw byEmail.error;
  }

  if (!byEmail.data) return null;

  const profile = byEmail.data as BusinessUser;
  if (markLogin) await stampLastLogin(profile);
  return profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [businessUser, setBusinessUser] = useState<BusinessUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshProfile() {
    const client = getSupabaseClient();
    const { data, error: sessionError } = await client.auth.getSession();

    if (sessionError) {
      setAuthUser(null);
      setBusinessUser(null);
      setError(sessionError.message);
      return;
    }

    const currentUser = data.session?.user ?? null;
    setAuthUser(currentUser);

    if (!currentUser) {
      setBusinessUser(null);
      setError(null);
      return;
    }

    const profile = await loadBusinessProfile(currentUser);
    setBusinessUser(profile);
    setError(null);
  }

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseClient();

    async function initialise() {
      try {
        await refreshProfile();
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Could not load user profile.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    initialise();

    const { data: subscription } = client.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      setAuthUser(session?.user ?? null);
      setLoading(true);
      try {
        const profile = await loadBusinessProfile(session?.user ?? null, event === 'SIGNED_IN');
        if (mounted) {
          setBusinessUser(profile);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Could not load user profile.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ authUser, businessUser, loading, error, refreshProfile }),
    [authUser, businessUser, loading, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
