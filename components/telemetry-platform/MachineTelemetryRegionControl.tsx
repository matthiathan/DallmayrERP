'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { TelemetryRegion } from '@/types/dallmayrerp';
import { telemetryRegionLabel } from './TelemetryRegionSelector';
import styles from './MachineTelemetryRegionControl.module.css';

const regions: TelemetryRegion[] = ['south_africa', 'dubai', 'europe'];

type MachineRegionRow = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  telemetry_region: TelemetryRegion;
};

export function MachineTelemetryRegionControl({ machineId }: { machineId: string }) {
  const { userDetails } = useAuth();
  const [machine, setMachine] = useState<MachineRegionRow | null>(null);
  const [target, setTarget] = useState<TelemetryRegion | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = userDetails?.role === 'admin' || userDetails?.role === 'operations';

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    getSupabaseClient().from('machines').select('id,machine_name,serial_number,telemetry_region').eq('id', machineId).maybeSingle()
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) setError(loadError.message);
        else if (data) {
          const row = data as MachineRegionRow;
          setMachine(row);
          setTarget(row.telemetry_region);
        }
      });
    return () => { cancelled = true; };
  }, [canManage, machineId]);

  if (!canManage || !machine) return null;

  const moveMachine = async () => {
    if (!target || target === machine.telemetry_region) return;
    const confirmed = window.confirm(`Move this machine and all linked telemetry devices from ${telemetryRegionLabel(machine.telemetry_region)} to ${telemetryRegionLabel(target)}?`);
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    try {
      const { error: moveError } = await getSupabaseClient().rpc('set_machine_telemetry_region', {
        p_machine_id: machineId,
        p_region: target,
      });
      if (moveError) throw moveError;
      window.location.assign('/machines');
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'Could not move the machine to the selected region.');
      setLoading(false);
    }
  };

  return (
    <section className={styles.control} aria-label="Machine telemetry region">
      <div>
        <span>Telemetry region</span>
        <strong>{telemetryRegionLabel(machine.telemetry_region)}</strong>
        <small>Changing region moves this machine and its linked telemetry device together.</small>
      </div>
      <div className={styles.actions}>
        <label>
          <span className={styles.srOnly}>Move machine to region</span>
          <select disabled={loading} onChange={(event) => setTarget(event.target.value as TelemetryRegion)} value={target}>
            {regions.map((region) => <option key={region} value={region}>{telemetryRegionLabel(region)}</option>)}
          </select>
        </label>
        <button disabled={loading || target === machine.telemetry_region} onClick={moveMachine} type="button">{loading ? 'Moving…' : 'Move region'}</button>
      </div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </section>
  );
}
