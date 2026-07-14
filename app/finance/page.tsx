import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';

const features = [
  'Customer credit days and credit limit visibility',
  'VAT and debit-order fields from customer master data',
  'Contract billing support and finance exports',
  'Inactive customer and high-risk account review',
];

export default function FinancePage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Finance</div>
          <h1>Finance Workspace</h1>
          <p>Credit, billing and customer-finance visibility for finance users.</p>
        </div>
      </div>
      <div className="grid grid-3">
        <KpiCard label="Credit Controls" value="Ready" helper="Credit days and limits are available in customer source data." />
        <KpiCard label="VAT Records" value="Tracked" helper="VAT TRN and VAT treatment fields are available." />
        <KpiCard label="Exports" value="Planned" helper="Finance exports will be added after workflow approval." />
      </div>
      <div className="neo-card" style={{ marginTop: 20 }}>
        <h2>Finance features</h2>
        <div className="feature-list">
          {features.map((item) => <div className="feature-pill" key={item}>{item}</div>)}
        </div>
      </div>
    </AppShell>
  );
}
