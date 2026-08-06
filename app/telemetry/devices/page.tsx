import { AdminTelemetryDevices } from '@/components/features/AdminTelemetryDevices';
import { AppShell } from '@/components/layout/AppShell';

export default function TelemetryDevicesPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Administrator only</div>
          <h1>Telemetry Devices</h1>
          <p>Assign telemetry controllers to ERP machines, verify connectivity and disable devices that must no longer send data.</p>
        </div>
      </div>
      <AdminTelemetryDevices />
    </AppShell>
  );
}
