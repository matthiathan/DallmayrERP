'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { countRawContracts, countRawCustomers, countRawServiceCalls } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ExecutiveBranchesPage() {
  const [data, setData] = useState({ customers: { jhb: 0, cpt: 0, kzn: 0 }, contracts: { jhb: 0, cpt: 0, kzn: 0 }, service: { jhb: 0, kzn: 0, cptPreventive: 0 } });

  useEffect(() => {
    async function load() {
      const client = getSupabaseClient();
      const [customers, contracts, service] = await Promise.all([countRawCustomers(client), countRawContracts(client), countRawServiceCalls(client)]);
      setData({ customers, contracts, service });
    }
    load().catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <div className="page-header"><div><h1>Branch Performance</h1><p>Compare JHB, CPT and KZN data coverage and operating activity.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Customers</th><th>Contracts</th><th>Service records</th></tr></thead><tbody><tr><td>JHB</td><td>{data.customers.jhb}</td><td>{data.contracts.jhb}</td><td>{data.service.jhb}</td></tr><tr><td>CPT</td><td>{data.customers.cpt}</td><td>{data.contracts.cpt}</td><td>{data.service.cptPreventive} preventive</td></tr><tr><td>KZN</td><td>{data.customers.kzn}</td><td>{data.contracts.kzn}</td><td>{data.service.kzn}</td></tr></tbody></table></div>
    </AppShell>
  );
}
