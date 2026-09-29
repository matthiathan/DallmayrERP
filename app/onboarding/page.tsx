'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { TelemetryRegion } from '@/types/dallmayrerp';
import styles from './OnboardingPage.module.css';

const regions: Array<{ value: TelemetryRegion; label: string; helper: string }> = [
  { value: 'south_africa', label: 'South Africa', helper: 'South African telemetry fleet' },
  { value: 'dubai', label: 'Dubai', helper: 'Dubai telemetry fleet' },
  { value: 'europe', label: 'Europe', helper: 'European telemetry fleet' },
];

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() ?? '',
    lastName: parts.join(' '),
  };
}

export default function OnboardingPage() {
  const router = useRouter();
  const { authUser, businessUser, userDetails, loading, refreshProfile } = useAuth();
  const [regionSaving, setRegionSaving] = useState(false);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadataName = useMemo(() => splitName(String(authUser?.user_metadata?.full_name ?? '')), [authUser]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [birthday, setBirthday] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');

  useEffect(() => {
    if (!userDetails) return;
    setFirstName(userDetails.first_name ?? metadataName.firstName);
    setLastName(userDetails.last_name ?? metadataName.lastName);
    setPhoneNumber(userDetails.phone_number ?? '');
    setBirthday(userDetails.birthday ?? '');
    setEmergencyContactName(userDetails.emergency_contact_name ?? '');
    setEmergencyContactPhone(userDetails.emergency_contact_phone ?? '');
  }, [metadataName.firstName, metadataName.lastName, userDetails]);

  useEffect(() => {
    if (!loading && !authUser) router.replace('/login');
  }, [authUser, loading, router]);

  async function chooseRegion(region: TelemetryRegion) {
    if (regionSaving) return;
    setRegionSaving(true);
    setError(null);
    try {
      const { error: regionError } = await getSupabaseClient().rpc('set_my_telemetry_region', { p_region: region });
      if (regionError) throw regionError;
      await refreshProfile();
    } catch (regionError) {
      setError(regionError instanceof Error ? regionError.message : 'Could not save your telemetry region.');
    } finally {
      setRegionSaving(false);
    }
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (detailsSaving) return;
    setDetailsSaving(true);
    setError(null);
    try {
      const { error: detailsError } = await getSupabaseClient().rpc('update_my_personal_details', {
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_phone_number: phoneNumber.trim(),
        p_birthday: birthday,
        p_emergency_contact_name: emergencyContactName.trim(),
        p_emergency_contact_phone: emergencyContactPhone.trim(),
      });
      if (detailsError) throw detailsError;
      await refreshProfile();
      router.replace('/');
    } catch (detailsError) {
      setError(detailsError instanceof Error ? detailsError.message : 'Could not save your personal details.');
    } finally {
      setDetailsSaving(false);
    }
  }

  if (loading || !authUser || !businessUser) {
    return (
      <main className={styles.page}>
        <section className={`neo-card ${styles.card}`}>
          <HamsterLoader label="Preparing your account" />
        </section>
      </main>
    );
  }

  const regionSelected = Boolean(userDetails?.telemetry_region);

  return (
    <main className={styles.page}>
      <section className={`neo-card ${styles.card}`}>
        <header className={styles.header}>
          <span>First-time setup</span>
          <h1>Set up your DallmayrERP account</h1>
          <p>Your region controls which telemetry fleet you can see. Your personal details are used for your account profile.</p>
        </header>

        <div className={styles.progress} aria-label="Onboarding progress">
          <span className={!regionSelected ? styles.active : ''}>1. Choose region</span>
          <span className={regionSelected ? styles.active : ''}>2. Personal details</span>
        </div>

        {error ? <div className="error" role="alert">{error}</div> : null}

        {!regionSelected ? (
          <div className={styles.regions}>
            {regions.map((region) => (
              <button
                className={styles.regionButton}
                disabled={regionSaving}
                key={region.value}
                onClick={() => void chooseRegion(region.value)}
                type="button"
              >
                <strong>{region.label}</strong>
                <small>{region.helper}</small>
              </button>
            ))}
          </div>
        ) : (
          <form className={styles.form} onSubmit={saveDetails}>
            <label>
              First name
              <input autoComplete="given-name" onChange={(event) => setFirstName(event.target.value)} required value={firstName} />
            </label>
            <label>
              Last name
              <input autoComplete="family-name" onChange={(event) => setLastName(event.target.value)} required value={lastName} />
            </label>
            <label>
              Phone number
              <input autoComplete="tel" onChange={(event) => setPhoneNumber(event.target.value)} required type="tel" value={phoneNumber} />
            </label>
            <label>
              Birthday
              <input max={new Date().toISOString().slice(0, 10)} onChange={(event) => setBirthday(event.target.value)} required type="date" value={birthday} />
            </label>
            <label>
              Emergency contact name
              <input onChange={(event) => setEmergencyContactName(event.target.value)} required value={emergencyContactName} />
            </label>
            <label>
              Emergency contact phone
              <input autoComplete="tel" onChange={(event) => setEmergencyContactPhone(event.target.value)} required type="tel" value={emergencyContactPhone} />
            </label>
            <div className={styles.actions}>
              <button className="button" disabled={detailsSaving} type="submit">
                {detailsSaving ? 'Saving…' : 'Finish setup'}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
