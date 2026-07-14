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

  const max = Math.max(1, counts.jhb, counts.kzn, counts.cptPreventive);
  const heat = [
    { label: 'JHB', value: counts.jhb },
    { label: 'KZN', value: counts.kzn },
    { label: 'CPT', value: counts.cptPreventive },
  ];

  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card"><div><h1>Service Performance</h1><p>Executive monitoring for technician workload, open risk and service history.</p></div></div>
      <div className="grid grid-3 spatial-kpi-grid" style={{ marginBottom: 20 }}><KpiCard label="JHB service calls" value={counts.jhb} /><KpiCard label="KZN service calls" value={counts.kzn} /><KpiCard label="CPT preventive services" value={counts.cptPreventive} /></div>
      <div className="card spatial-stage spatial-service-heat spatial-card" style={{ marginTop: 20 }}>
        <h2>Service workload heat areas</h2>
        <p>Desktop spatial view for comparing service load intensity by branch.</p>
        {heat.map((branch) => (
          <div className="spatial-heat-row" key={branch.label}>
            <strong>{branch.label}</strong>
            <div className="spatial-heat-track"><div className="spatial-heat-fill" style={{ width: `${Math.max(5, (branch.value / max) * 100)}%` }} /></div>
            <span>{branch.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="card spatial-card" style={{ marginTop: 20 }}><h2>Next performance metrics</h2><ul><li>Open service calls</li><li>High-priority jobs</li><li>Average time taken</li><li>Repeat failures by serial number</li><li>Technician and road technician workload</li></ul></div>
    </AppShell>
  );
}
