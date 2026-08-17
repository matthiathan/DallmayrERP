import { Suspense } from 'react';
import { EnterpriseDeliveryBoard } from '@/components/features/EnterpriseDeliveryBoard';
import { AppShell } from '@/components/layout/AppShell';
import { ErpPage, ErpPageHeader, ErpStateBanner } from '@/components/ui/ErpLayout';

export default function OperationsDeliveriesPage() {
  return (
    <AppShell>
      <ErpPage variant="operational">
        <ErpPageHeader
          description="Track, filter and move delivery orders through controlled operating stages."
          eyebrow="Operations"
          title="Delivery Board"
        />
        <Suspense fallback={<ErpStateBanner message="Preparing delivery orders and execution controls." title="Loading delivery execution" />}>
          <EnterpriseDeliveryBoard />
        </Suspense>
      </ErpPage>
    </AppShell>
  );
}
