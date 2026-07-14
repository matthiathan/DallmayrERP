import { AppShell } from '@/components/layout/AppShell';

export default function ExecutiveReportsPage() {
  return (
    <AppShell>
      <div className="page-header"><div><h1>Executive Reports</h1><p>Board-level and management reporting pack for DallmayrERP.</p></div></div>
      <div className="grid grid-2">
        <div className="card"><h2>Report pack</h2><ul><li>Monthly operations summary</li><li>Branch comparison report</li><li>Contract expiry report</li><li>Service performance report</li><li>Warehouse stock risk report</li><li>Customer health report</li></ul></div>
        <div className="card"><h2>Next implementation</h2><p>Create SQL summary views for customers, contracts, service, stock and branches. Then bind charts and export actions to these views.</p></div>
      </div>
    </AppShell>
  );
}
