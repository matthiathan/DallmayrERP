import { AppShell } from '@/components/layout/AppShell';
import { ExecutiveReportingPanel } from '@/components/features/ExecutiveReportingPanel';

export default function ExecutiveOverviewPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Executive</div>
          <h1>Executive Overview</h1>
          <p>Strategic snapshot across customers, contracts, service, warehouse, delivery orders and branch digital work capture.</p>
        </div>
      </div>
      <ExecutiveReportingPanel />
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Executive focus areas</h2>
        <ul>
          <li>Compare branch customer base, contract volume and operational capture.</li>
          <li>Review digital task closures from technicians and road technicians.</li>
          <li>Track delivery order creation and stock scanning discipline.</li>
          <li>Use uploaded marketing and warehouse documentation as governance evidence.</li>
          <li>Hold branches accountable using the same source data operations use daily.</li>
        </ul>
      </div>
    </AppShell>
  );
}
