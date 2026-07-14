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

  const branches = [
    { label: 'JHB', customers: data.customers.jhb, contracts: data.contracts.jhb, service: data.service.jhb },
    { label: 'CPT', customers: data.customers.cpt, contracts: data.contracts.cpt, service: data.service.cptPreventive },
    { label: 'KZN', customers: data.customers.kzn, contracts: data.contracts.kzn, service: data.service.kzn },
  ];

  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card"><div><h1>Branch Performance</h1><p>Compare JHB, CPT and KZN data coverage and operating activity.</p></div></div>
      <div className="spatial-stage spatial-dashboard spatial-branch-overview card" style={{ marginBottom: 20 }}>
        <h2>Branch performance overview</h2>
        <div className="spatial-orbit-grid">
          {branches.map((branch) => (
            <div className="neo-card spatial-orbit-card spatial-card" key={branch.label}>
              <div className="badge">{branch.label}</div>
              <h3>{branch.customers.toLocaleString()} customers</h3>
              <p>{branch.contracts.toLocaleString()} contracts · {branch.service.toLocaleString()} service records</p>
            </div>
          ))}
        </div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Customers</th><th>Contracts</th><th>Service records</th></tr></thead><tbody>{branches.map((branch) => <tr key={branch.label}><td>{branch.label}</td><td>{branch.customers}</td><td>{branch.contracts}</td><td>{branch.service}</td></tr>)}</tbody></table></div>
    </AppShell>
  );
}
