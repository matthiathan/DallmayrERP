import { AdminTelemetryDevices } from '@/components/features/AdminTelemetryDevices';
import { AppShell } from '@/components/layout/AppShell';

export default function TelemetryDevicesPage() {
  return (
    <AppShell>
      <div className="fleet-page-heading">
        <div>
          <span className="fleet-eyebrow">Administrator only</span>
          <h1>Telemetry devices</h1>
          <p>Assign controllers to machines, verify connectivity and manage device access.</p>
        </div>
      </div>
      <AdminTelemetryDevices />
    </AppShell>
  );
}
