import { AppShell } from '@/components/layout/AppShell';
import { TaskClosurePanel } from '@/components/features/TaskClosurePanel';

export default function RoadTechnicianPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card field-service-page-header">
        <div>
          <div className="badge">Road technician</div>
          <h1>My Field Jobs</h1>
          <p>Work through assigned field jobs by urgency, verify the customer machine and submit on-site closure evidence.</p>
        </div>
      </div>
      <TaskClosurePanel taskType="road_technician" />
    </AppShell>
  );
}
