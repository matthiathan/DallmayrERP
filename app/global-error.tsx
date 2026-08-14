'use client';

import { ApplicationFailureScreen } from '@/components/system/ApplicationFailureScreen';

type GlobalErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorBoundaryProps) {
  const reference = error.digest ? `ERP-GLOBAL-${error.digest}` : 'ERP-GLOBAL-UNEXPECTED';

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <ApplicationFailureScreen
          eyebrow="Application error"
          title="DallmayrERP could not start correctly."
          description="A critical application error interrupted the ERP before the normal workspace could load. Retry the application, or return to the dashboard to start a fresh navigation."
          reference={reference}
          onRetry={reset}
          announceAsAlert
          tone="danger"
        />
      </body>
    </html>
  );
}
