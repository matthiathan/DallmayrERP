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
    if (!businessUser || !userDetails) return;

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const cleanPhone = phoneNumber.trim();
    const cleanEmergencyName = emergencyContactName.trim();
    const cleanEmergencyPhone = emergencyContactPhone.trim();

    if (!cleanFirstName || !cleanLastName || !cleanPhone || !birthday || !cleanEmergencyName || !cleanEmergencyPhone) {
      setError('All personal details are required before the role workspace can unlock.');
      return;
    }

    setSaving(true);
    setError(null);

    const { error: detailsError } = await getSupabaseClient()
      .from('user_details')
      .update({
        first_name: cleanFirstName,
        last_name: cleanLastName,
        phone_number: cleanPhone,
        birthday,
        emergency_contact_name: cleanEmergencyName,
        emergency_contact_phone: cleanEmergencyPhone,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', businessUser.id);

    setSaving(false);

    if (detailsError) {
      setError(detailsError.message);
      return;
    }

    await refreshProfile();
    router.replace(getDefaultPathForRole(userDetails.role));
  }

  return (
    <AppShell>
      <div className="concentrix-onboarding-stage">
        <div className="page-header hero-panel">
          <div>
            <div className="badge">First login setup</div>
            <h1>Complete your Dallmayr Telemetry profile</h1>
            <p>
              Your administrator has already assigned your role and branch. Complete your personal details once to unlock your assigned workspace.
            </p>
          </div>
        </div>

        {error ? <div className="error" style={{ marginBottom: 18 }}>{error}</div> : null}

        <div className="grid grid-2">
          <div className="neo-card">
            <h2>Your assigned access</h2>
            <div className="feature-list">
              <span className="feature-pill">Role: {userDetails?.role}</span>
              <span className="feature-pill">Branch: {userDetails?.branch}</span>
              <span className="feature-pill">Email: {businessUser?.email}</span>
            </div>
            <p>Role and branch are controlled by admin and cannot be changed on this page.</p>
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
                <input required type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} />
              </label>
              <label>
                Emergency contact name
                <input required value={emergencyContactName} onChange={(event) => setEmergencyContactName(event.target.value)} />
              </label>
              <label>
                Emergency contact phone
                <input required value={emergencyContactPhone} onChange={(event) => setEmergencyContactPhone(event.target.value)} />
              </label>
              <button className="button pulse-button" type="submit" disabled={saving}>
                {saving ? 'Saving profile...' : 'Complete profile'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
