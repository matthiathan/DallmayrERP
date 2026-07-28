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
import './call-log-creation.css';
import './appearance-panel.css';
import './appearance-customization.css';
import './field-service-workflow.css';
import { AccessStatusGuard } from '@/components/auth/AccessStatusGuard';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AppearanceProvider } from '@/components/appearance/AppearanceProvider';
import { GlobalAccountMenu } from '@/components/layout/GlobalAccountMenu';

const APPEARANCE_BOOT_SCRIPT = `
(function () {
  try {
    var defaults = {
      accentColor: '#d4af37',
      themeColor: '#7a4b22',
      backgroundColor: '#0d0905',
      themeTone: 'dark',
      backgroundStyle: 'aurora'
    };
    var raw = window.localStorage.getItem('dallmayrerp-appearance-v1');
    var saved = raw ? JSON.parse(raw) : {};
    var hex = /^#[0-9a-f]{6}$/i;
    var accent = hex.test(saved.accentColor || '') ? saved.accentColor : defaults.accentColor;
    var theme = hex.test(saved.themeColor || '') ? saved.themeColor : defaults.themeColor;
    var background = hex.test(saved.backgroundColor || '') ? saved.backgroundColor : defaults.backgroundColor;
    var tone = saved.themeTone === 'light' ? 'light' : 'dark';
    var styles = ['aurora', 'mesh', 'dots', 'solid'];
    var backgroundStyle = styles.indexOf(saved.backgroundStyle) >= 0 ? saved.backgroundStyle : defaults.backgroundStyle;
    var red = parseInt(accent.slice(1, 3), 16);
    var green = parseInt(accent.slice(3, 5), 16);
    var blue = parseInt(accent.slice(5, 7), 16);
    var luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    var root = document.documentElement;
    root.dataset.themeTone = tone;
    root.dataset.backgroundStyle = backgroundStyle;
    root.style.setProperty('--user-accent', accent);
    root.style.setProperty('--user-theme', theme);
    root.style.setProperty('--user-background', background);
    root.style.setProperty('--accent-ink', luminance > 0.58 ? '#101318' : '#ffffff');
    root.style.colorScheme = tone;
  } catch (error) {
    document.documentElement.dataset.themeTone = 'dark';
    document.documentElement.dataset.backgroundStyle = 'aurora';
  }
})();`;

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
    <html
      data-background-style="aurora"
      data-theme-tone="dark"
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <AppearanceProvider>
            <AccessStatusGuard>
              <GlobalAccountMenu />
              {children}
            </AccessStatusGuard>
          </AppearanceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
