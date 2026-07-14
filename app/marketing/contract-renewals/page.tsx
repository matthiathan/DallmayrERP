'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { countRawContracts } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ContractRenewalsPage() {
  const [counts, setCounts] = useState({ jhb: 0, cpt: 0, kzn: 0, total: 0 });

  useEffect(() => {
    countRawContracts(getSupabaseClient()).then(setCounts).catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <div className="page-header"><div><h1>Contract Renewal Marketing</h1><p>Use contract data to prepare renewal and retention campaigns.</p></div></div>
      <div className="grid grid-3">
        <KpiCard label="JHB contracts" value={counts.jhb} />
        <KpiCard label="CPT contracts" value={counts.cpt} />
        <KpiCard label="KZN contracts" value={counts.kzn} />
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Next build items</h2>
        <ul>
          <li>Parse contract start and end dates into a normalized renewal view.</li>
          <li>Show contracts expiring in 30, 60 and 90 days.</li>
          <li>Create campaign lists for contract renewal follow-up.</li>
          <li>Link renewal opportunities to customer contact details.</li>
        </ul>
      </div>
    </AppShell>
  );
}
