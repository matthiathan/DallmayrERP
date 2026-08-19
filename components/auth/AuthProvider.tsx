'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 10000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

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
  if (!authUser?.id) return null;

  try {
    const client = getSupabaseClient();

    // Older DallmayrERP accounts may still have a matching profile row. Claim
    // and load it when available so names and saved appearance preferences keep
    // working, but never make that legacy record a condition of authentication.
    await client.rpc('claim_current_app_user');

    const { data: userRecord, error: userError } = await client
      .from('users')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    if (userError || !userRecord) return null;

    let details: UserDetails | null = null;
    try {
      details = await loadDetails(userRecord.id);
    } catch {
      details = null;
    }

    return {
      user: userRecord as BusinessUser,
      details,
    };
  } catch {
    // Supabase Auth is the access authority for the telemetry-only app. A
    // missing ERP profile or role must not turn a valid session into a logout.
    return null;
  }
}

async function loadFromSession() {
  const client = getSupabaseClient();
  const { data, error: sessionError } = await withTimeout(
    client.auth.getSession(),
    'Timed out while checking your secure session. Please refresh the page or sign in again.',
  );

  if (sessionError) throw sessionError;

  const currentUser = data.session?.user ?? null;
  const profile = currentUser
    ? await withTimeout(loadBusinessProfile(currentUser), 'Optional account details timed out.').catch(() => null)
    : null;

  return { currentUser, profile };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    setLoading(true);
    try {
      const { currentUser, profile } = await loadFromSession();
      setAuthUser(currentUser);
      setBusinessProfile(profile);
      setError(null);
    } catch (err) {
      setAuthUser(null);
      setBusinessProfile(null);
      setError(err instanceof Error ? err.message : 'Could not load user profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    async function initialise() {
      try {
        const client = getSupabaseClient();
        const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
          if (!mounted) return;
          setAuthUser(session?.user ?? null);
          setLoading(true);

          window.setTimeout(async () => {
            if (!mounted) return;
            try {
              const profile = await withTimeout(
                loadBusinessProfile(session?.user ?? null),
                'Timed out while loading optional account details.',
              );
              if (!mounted) return;
              setBusinessProfile(profile);
              setError(null);
            } catch {
              if (!mounted) return;
              setBusinessProfile(null);
              setError(null);
            } finally {
              if (mounted) setLoading(false);
            }
          }, 0);
        });
        unsubscribe = () => subscription.subscription.unsubscribe();

        const { currentUser, profile } = await loadFromSession();
        if (!mounted) return;
        setAuthUser(currentUser);
        setBusinessProfile(profile);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        setAuthUser(null);
        setBusinessProfile(null);
        setError(err instanceof Error ? err.message : 'Could not load user profile.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    initialise();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const businessUser = businessProfile?.user ?? null;
  const userDetails = businessProfile?.details ?? null;

  const value = useMemo(
    () => ({ authUser, businessUser, userDetails, businessProfile, loading, error, refreshProfile }),
    [authUser, businessUser, userDetails, businessProfile, loading, error, refreshProfile],
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
