import { MachineAssetBoard } from '@/components/features/MachineAssetBoard';
import { AppShell } from '@/components/layout/AppShell';
import { ErpPage, ErpPageHeader } from '@/components/ui/ErpLayout';
import './assets-mobile-polish.css';

export default function OperationsAssetsPage() {
  return (
    <AppShell>
      <ErpPage variant="list">
        <ErpPageHeader
          description="Build machine records for barcode lookup, service history and customer-site accountability."
          eyebrow="Operations"
          title="Machine Assets"
        />
        <MachineAssetBoard />
      </ErpPage>
    </AppShell>
  );
}
