import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';

const features = [
  'Daily route visibility and job priority list',
  'Customer address, building and location fields',
  'Start and end time capture planning',
  'On-site close-out notes and proof-of-work planning',
];

export default function RoadTechnicianPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Road technician</div>
          <h1>Road Tech Routes</h1>
          <p>Field-service route and customer-site workspace for road technicians.</p>
        </div>
      </div>
      <div className="grid grid-3">
        <KpiCard label="Routes" value="Planned" helper="Route optimisation will use addresses and location links." />
        <KpiCard label="Jobs" value="Prioritised" helper="Priority fields are available from service call logs." />
        <KpiCard label="Close-out" value="Mobile-first" helper="Future proof-of-work flow will be optimised for phones." />
      </div>
      <div className="neo-card" style={{ marginTop: 20 }}>
        <h2>Road technician features</h2>
        <div className="feature-list">
          {features.map((item) => <div className="feature-pill" key={item}>{item}</div>)}
        </div>
      </div>
    </AppShell>
  );
}
