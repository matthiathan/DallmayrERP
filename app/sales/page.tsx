import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';

const features = [
  'Customer and branch pipeline review',
  'Expiring contracts for renewal follow-up',
  'Customer category and salesman filtering',
  'Opportunities for upgrades, new machines and reactivation',
];

export default function SalesPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Sales</div>
          <h1>Sales Workspace</h1>
          <p>Customer growth, contract renewal and opportunity tracking for sales staff.</p>
        </div>
      </div>
      <div className="grid grid-3">
        <KpiCard label="Renewals" value="30/60/90" helper="Use contract expiry windows to focus follow-ups." />
        <KpiCard label="Customers" value="Segmented" helper="Filter by branch, category and customer status." />
        <KpiCard label="Opportunities" value="Planned" helper="Future opportunity tracking will link to customers." />
      </div>
      <div className="neo-card" style={{ marginTop: 20 }}>
        <h2>Sales features</h2>
        <div className="feature-list">
          {features.map((item) => <div className="feature-pill" key={item}>{item}</div>)}
        </div>
      </div>
    </AppShell>
  );
}
