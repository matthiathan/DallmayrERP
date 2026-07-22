'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';

export function AccessStatusGuard({ children }: { children: ReactNode }) {
  const { businessUser, loading } = useAuth();

  if (loading || !businessUser || businessUser.is_active !== false) {
    return <>{children}</>;
  }

  async function signOut() {
    await getSupabaseClient().auth.signOut();
    window.location.href = '/login';
  }

  return (
    <main className="main auth-state-page access-suspended-page" role="main">
      <div className="neo-card auth-state-card">
        <div className="badge danger">Access suspended</div>
        <h1>ERP access suspended</h1>
        <p>Your DallmayrERP access has been suspended by an Administrator. Your profile and operational history have been retained, but no ERP rights are currently active.</p>
        {businessUser.access_note ? <div className="info"><strong>Administrator note</strong><span>{businessUser.access_note}</span></div> : null}
        <div className="action-row">
          <button className="button secondary" onClick={signOut} type="button">Sign out</button>
        </div>
      </div>
    </main>
  );
}
