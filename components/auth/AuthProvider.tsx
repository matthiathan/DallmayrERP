'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { BusinessProfile, BusinessUser, UserDetails } from '@/types/dallmayrerp';

type AuthContextValue = {
  authUser: User | null;
  businessUser: BusinessUser | null;
  userDetails: UserDetails | null;
  businessProfile: BusinessProfile | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function loadDetails(userId: string): Promise<UserDetails | null> {
  const { data, error } = await getSupabaseClient()
    .from('user_details')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as UserDetails | null;
}

async function loadBusinessProfile(authUser: User | null): Promise<BusinessProfile | null> {
  if (!authUser?.email) return null;

  const client = getSupabaseClient();
  const email = authUser.email.trim().toLowerCase();

  const { data: userRecord, error: userError } = await client
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (userError) throw userError;
  if (!userRecord) return null;

  const details = await loadDetails(userRecord.id);
  if (!details) return null;

  return {
    user: userRecord as BusinessUser,
    details,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshProfile() {
    const client = getSupabaseClient();
    const { data, error: sessionError } = await client.auth.getSession();

    if (sessionError) {
      setAuthUser(null);
      setBusinessProfile(null);
      setError(sessionError.message);
      return;
    }

    const currentUser = data.session?.user ?? null;
    setAuthUser(currentUser);

    if (!currentUser) {
      setBusinessProfile(null);
      setError(null);
      return;
    }

    const profile = await loadBusinessProfile(currentUser);
    setBusinessProfile(profile);
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

    const { data: subscription } = client.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      setAuthUser(session?.user ?? null);
      setLoading(true);
      try {
        const profile = await loadBusinessProfile(session?.user ?? null);
        if (mounted) {
          setBusinessProfile(profile);
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

  const businessUser = businessProfile?.user ?? null;
  const userDetails = businessProfile?.details ?? null;

  const value = useMemo(
    () => ({ authUser, businessUser, userDetails, businessProfile, loading, error, refreshProfile }),
    [authUser, businessUser, userDetails, businessProfile, loading, error],
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
