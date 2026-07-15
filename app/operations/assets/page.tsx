import { MachineAssetBoard } from '@/components/features/MachineAssetBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsAssetsPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations</div>
          <h1>Machine Assets</h1>
          <p>Build machine records for barcode lookup, service history and customer-site accountability.</p>
        </div>
      </div>
      <MachineAssetBoard />
    </AppShell>
  );
}
