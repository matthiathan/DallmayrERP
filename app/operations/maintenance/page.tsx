import { PreventiveMaintenanceBoard } from '@/components/features/PreventiveMaintenanceBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function PreventiveMaintenancePage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Maintenance</div>
          <h1>Preventive Maintenance</h1>
          <p>Calendar and meter-based service plans with automatic work generation and reusable checklists.</p>
        </div>
      </div>
      <PreventiveMaintenanceBoard />
    </AppShell>
  );
}
