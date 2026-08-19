import { TelemetryLocationMap } from '@/components/features/TelemetryLocationMap';
import { AppShell } from '@/components/layout/AppShell';

export default function MachineMapPage() {
  return (
    <AppShell>
      <section className="fleet-route-page">
        <header className="fleet-page-heading">
          <div>
            <span className="fleet-eyebrow">Machine &amp; telemetry monitoring</span>
            <h1>Machine locations</h1>
            <p>Last known device positions, connection health and movement status.</p>
          </div>
        </header>
        <TelemetryLocationMap />
      </section>
    </AppShell>
  );
}
