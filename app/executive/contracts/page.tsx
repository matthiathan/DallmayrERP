'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { countRawContracts } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ExecutiveContractsPage() {
  const [counts, setCounts] = useState({ jhb: 0, cpt: 0, kzn: 0, total: 0 });

  useEffect(() => {
    countRawContracts(getSupabaseClient()).then(setCounts).catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <div className="page-header"><div><h1>Contract Risk</h1><p>Executive view of contract coverage, renewals and expiry risk.</p></div></div>
      <div className="grid grid-3"><KpiCard label="JHB contracts" value={counts.jhb} /><KpiCard label="CPT contracts" value={counts.cpt} /><KpiCard label="KZN contracts" value={counts.kzn} /></div>
      <div className="card" style={{ marginTop: 20 }}><h2>Next risk metrics</h2><ul><li>Expired contracts</li><li>Contracts expiring in 30 / 60 / 90 days</li><li>Customers with no current agreement</li><li>Contracts by agreement type</li><li>Contracts by salesman and branch</li></ul></div>
    </AppShell>
  );
}
