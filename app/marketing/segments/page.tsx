'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { countRawCustomers } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function MarketingSegmentsPage() {
  const [counts, setCounts] = useState({ jhb: 0, cpt: 0, kzn: 0, total: 0 });

  useEffect(() => {
    countRawCustomers(getSupabaseClient()).then(setCounts).catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <div className="page-header"><div><h1>Customer Segments</h1><p>Starting point for branch, renewal, retention and service-based campaigns.</p></div></div>
      <div className="grid grid-3">
        <KpiCard label="JHB customers" value={counts.jhb} />
        <KpiCard label="CPT customers" value={counts.cpt} />
        <KpiCard label="KZN customers" value={counts.kzn} />
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Segment types to implement</h2>
        <ul>
          <li>Active and inactive customers</li>
          <li>Customers with expiring contracts</li>
          <li>Customers with many service calls</li>
          <li>Customers with machines mapped</li>
          <li>Customers without machines mapped</li>
          <li>Customers by salesman, area, category and branch</li>
        </ul>
      </div>
    </AppShell>
  );
}
