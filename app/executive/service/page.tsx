'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { countRawServiceCalls } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ExecutiveServicePage() {
  const [counts, setCounts] = useState({ jhb: 0, kzn: 0, cptPreventive: 0, total: 0 });

  useEffect(() => {
    countRawServiceCalls(getSupabaseClient()).then(setCounts).catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <div className="page-header"><div><h1>Service Performance</h1><p>Executive monitoring for technician workload, open risk and service history.</p></div></div>
      <div className="grid grid-3"><KpiCard label="JHB service calls" value={counts.jhb} /><KpiCard label="KZN service calls" value={counts.kzn} /><KpiCard label="CPT preventive services" value={counts.cptPreventive} /></div>
      <div className="card" style={{ marginTop: 20 }}><h2>Next performance metrics</h2><ul><li>Open service calls</li><li>High-priority jobs</li><li>Average time taken</li><li>Repeat failures by serial number</li><li>Technician and road technician workload</li></ul></div>
    </AppShell>
  );
}
