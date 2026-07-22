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
import './account-menu.css';
import './account-menu-brand-placement.css';
import './professional-layout-system.css';
import './user-first-layout.css';
import './scanner-feedback-fix.css';
import './dark-bezel-navigation.css';
import './fixed-top-navigation.css';
import './role-workspace-details.css';
import './reliability-machine-search.css';
import './desktop-nav-overflow.css';
import './table-column-filters.css';
import './monthly-service-planning.css';
import './operations-manager.css';
import './admin-user-access-control.css';
import { AccessStatusGuard } from '@/components/auth/AccessStatusGuard';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { GlobalAccountMenu } from '@/components/layout/GlobalAccountMenu';

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
        <AuthProvider>
          <AccessStatusGuard>
            <GlobalAccountMenu />
            {children}
          </AccessStatusGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
