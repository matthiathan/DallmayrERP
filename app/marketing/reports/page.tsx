import { AppShell } from '@/components/layout/AppShell';

export default function MarketingReportsPage() {
  return (
    <AppShell>
      <div className="page-header"><div><h1>Marketing Reports</h1><p>Campaign, segmentation and customer intelligence reporting.</p></div></div>
      <div className="grid grid-2">
        <div className="card"><h2>Reports to build</h2><ul><li>Customer segment export</li><li>Branch customer report</li><li>Contract renewal target list</li><li>High-service customer retention list</li><li>Campaign performance report</li></ul></div>
        <div className="card"><h2>Data sources</h2><ul><li>customer_master_jhb / cpt / kzn</li><li>contract_agreement_jhb / cpt / kzn</li><li>service_call_log_jhb / kzn</li><li>fixed_assets</li><li>marketing_campaigns</li></ul></div>
      </div>
    </AppShell>
  );
}
