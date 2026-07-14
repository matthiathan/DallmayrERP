'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { getDefaultPathForRole } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function OnboardingPage() {
  const router = useRouter();
  const { businessUser, userDetails, refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [birthday, setBirthday] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(userDetails?.first_name ?? '');
    setLastName(userDetails?.last_name ?? '');
    setPhoneNumber(userDetails?.phone_number ?? '');
    setBirthday(userDetails?.birthday ?? '');
    setEmergencyContactName(userDetails?.emergency_contact_name ?? '');
    setEmergencyContactPhone(userDetails?.emergency_contact_phone ?? '');
  }, [userDetails]);

  async function completeProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser) return;

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const cleanPhone = phoneNumber.trim();

    if (!cleanFirstName || !cleanLastName || !cleanPhone) {
      setError('First name, last name and phone number are required.');
      return;
    }

    setSaving(true);
    setError(null);

    const now = new Date().toISOString();
    const payload = {
      user_id: businessUser.id,
      first_name: cleanFirstName,
      last_name: cleanLastName,
      phone_number: cleanPhone,
      birthday: birthday || null,
      emergency_contact_name: emergencyContactName.trim() || null,
      emergency_contact_phone: emergencyContactPhone.trim() || null,
      profile_completed_at: now,
      updated_at: now,
    };

    const { error: detailsError } = await getSupabaseClient()
      .from('user_details')
      .upsert(payload, { onConflict: 'user_id' });

    if (detailsError) {
      setSaving(false);
      setError(detailsError.message);
      return;
    }

    await getSupabaseClient()
      .from('users')
      .update({ onboarding_required: false, profile_completed_at: now, updated_at: now })
      .eq('id', businessUser.id);

    setSaving(false);
    await refreshProfile();
    router.replace(getDefaultPathForRole(businessUser.role));
  }

  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">First login setup</div>
          <h1>Complete your DallmayrERP profile</h1>
          <p>
            Your administrator has already assigned your role, department and branch. Complete your personal details once to unlock your assigned workspace.
          </p>
        </div>
      </div>

      {error ? <div className="error" style={{ marginBottom: 18 }}>{error}</div> : null}

      <div className="grid grid-2">
        <div className="neo-card">
          <h2>Your assigned access</h2>
          <div className="feature-list">
            <span className="feature-pill">Role: {businessUser?.role}</span>
            <span className="feature-pill">Department: {businessUser?.department}</span>
            <span className="feature-pill">Branch: {businessUser?.branch ?? 'not assigned'}</span>
            <span className="feature-pill">Email: {businessUser?.email}</span>
          </div>
          <p>These access fields are controlled by admin and cannot be changed on this page.</p>
        </div>

        <div className="neo-card">
          <h2>Personal details</h2>
          <form className="grid" onSubmit={completeProfile}>
            <label>
              First name
              <input required value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </label>
            <label>
              Last name
              <input required value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </label>
            <label>
              Phone number
              <input required value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} />
            </label>
            <label>
              Birthday
              <input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} />
            </label>
            <label>
              Emergency contact name
              <input value={emergencyContactName} onChange={(event) => setEmergencyContactName(event.target.value)} />
            </label>
            <label>
              Emergency contact phone
              <input value={emergencyContactPhone} onChange={(event) => setEmergencyContactPhone(event.target.value)} />
            </label>
            <button className="button pulse-button" type="submit" disabled={saving}>
              {saving ? 'Saving profile...' : 'Complete profile'}
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
