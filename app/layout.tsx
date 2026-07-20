import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import './globals.css';
import './hamster-loader.css';
import './feature-widgets.css';
import './navigation.css';
import './spatial-desktop.css';
import './enterprise-ui.css';
import './stock-control.css';
import './professional-ops.css';
import './minimalist-ui.css';
import './minimalist-operations.css';
import './minimalist-ui-polish.css';
import './ux-polish.css';
import './density.css';
import './ultrawide.css';
import './mobile.css';
import './erp-classic-navigation.css';
import './notch-nav-fixes.css';
import './ribbon-background.css';
import './asset-ticket.css';
import './text-visibility-polish.css';
import './contrast-pairing.css';
import './professional-nowrap-layout.css';
import './resizable-tables.css';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { TwistingRibbonBackground } from '@/components/ui/TwistingRibbonBackground';

export const metadata = {
  title: 'DallmayrERP',
  description: 'Dallmayr South Africa internal operations ERP',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TwistingRibbonBackground />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
