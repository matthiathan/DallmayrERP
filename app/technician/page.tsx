import { AppShell } from '@/components/layout/AppShell';
import { TaskClosurePanel } from '@/components/features/TaskClosurePanel';

export default function TechnicianPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card field-service-page-header">
        <div>
          <div className="badge">Technician</div>
          <h1>My Technician Jobs</h1>
          <p>Review assigned work by urgency, verify the exact machine and complete the job with notes and proof.</p>
        </div>
      </div>
      <TaskClosurePanel taskType="technician" />
    </AppShell>
  );
}
