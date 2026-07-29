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
import './operations-dispatch.css';
import './customer-360.css';
import './operations-exceptions.css';
import './user-first-application-shell.css';
import './adaptive-contrast.css';
import './adaptive-contrast-final.css';
import './rendered-surface-contrast.css';
import './slate-sand-themes.css';
import './mobile-navigation-drawer.css';
import './mobile-data-views.css';
import './mobile-application-layout.css';
import './mobile-application-layout-final.css';
import './mobile-master-detail-actions.css';
import './mobile-offline-field-work.css';
import './mobile-notifications-pwa.css';
import './navigation-spacing-final.css';
import { AccessStatusGuard } from '@/components/auth/AccessStatusGuard';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AppearanceProvider } from '@/components/appearance/AppearanceProvider';
import { RenderedSurfaceContrastSync } from '@/components/appearance/RenderedSurfaceContrastSync';
import { FieldServiceOfflineManager } from '@/components/features/FieldServiceOfflineManager';
import { MobileAppExperience } from '@/components/features/MobileAppExperience';
import { GlobalAccountMenu } from '@/components/layout/GlobalAccountMenu';
import { MobileWorkflowEnhancer } from '@/components/ui/MobileWorkflowEnhancer';

const APPEARANCE_BOOT_SCRIPT = `
(function () {
  try {
    var raw = window.localStorage.getItem('dallmayrerp-appearance-v1');
    var saved = raw ? JSON.parse(raw) : {};
    var tone = saved.themeTone === 'light' ? 'light' : 'dark';
    var themes = {
      dark: {
        id: 'slate-modern',
        accent: '#22c3dc',
        accentInk: '#071318',
        accentOnLight: '#08778b',
        accentOnDark: '#67e8f9',
        theme: '#2b343d',
        background: '#0f1419',
        surface: '#20272f',
        raised: '#2b343d',
        text: '#f8fafc',
        strong: '#ffffff',
        muted: '#cbd5e1',
        subtle: '#a8b3bf',
        border: '#71808e',
        link: '#67e8f9',
        track: '#111820'
      },
      light: {
        id: 'warm-sand',
        accent: '#a67828',
        accentInk: '#11100d',
        accentOnLight: '#7a4d13',
        accentOnDark: '#d7b26b',
        theme: '#e6d7bf',
        background: '#f5efe5',
        surface: '#fffaf2',
        raised: '#f2e5d3',
        text: '#2b2118',
        strong: '#1f1812',
        muted: '#65584a',
        subtle: '#766858',
        border: '#9b8464',
        link: '#7a4d13',
        track: '#ded4c6'
      }
    };
    var selected = themes[tone];
    var root = document.documentElement;

    root.dataset.themeTone = tone;
    root.dataset.visualTheme = selected.id;
    root.dataset.backgroundStyle = 'solid';
    root.dataset.contrastGuard = 'active';
    root.dataset.contentTone = tone;
    root.style.setProperty('--user-accent', selected.accent);
    root.style.setProperty('--user-theme', selected.theme);
    root.style.setProperty('--user-background', selected.background);
    root.style.setProperty('--accent-ink', selected.accentInk);
    root.style.setProperty('--accent-on-light', selected.accentOnLight);
    root.style.setProperty('--accent-on-dark', selected.accentOnDark);
    root.style.setProperty('--accent-text', selected.link);
    root.style.setProperty('--focus-contrast', selected.link);
    root.style.setProperty('--theme-ink', selected.text);
    root.style.setProperty('--background-ink', selected.text);
    root.style.setProperty('--content-surface', selected.surface);
    root.style.setProperty('--content-surface-raised', selected.raised);
    root.style.setProperty('--content-text', selected.text);
    root.style.setProperty('--content-strong', selected.strong);
    root.style.setProperty('--content-muted', selected.muted);
    root.style.setProperty('--content-subtle', selected.subtle);
    root.style.setProperty('--content-border', selected.border);
    root.style.setProperty('--content-accent-text', selected.link);
    root.style.setProperty('--content-focus', selected.link);
    root.style.setProperty('--content-chart-track', selected.track);
    root.style.colorScheme = tone;
  } catch (error) {
    document.documentElement.dataset.themeTone = 'dark';
    document.documentElement.dataset.visualTheme = 'slate-modern';
    document.documentElement.dataset.backgroundStyle = 'solid';
    document.documentElement.dataset.contrastGuard = 'active';
  }
})();`;

export const metadata = {
  title: 'DallmayrERP',
  description: 'Dallmayr South Africa internal operations ERP',
  applicationName: 'DallmayrERP',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent' as const,
    title: 'DallmayrERP',
  },
  icons: {
    icon: '/icons/dallmayr-app.svg',
    apple: '/icons/dallmayr-app.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f1419',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      data-background-style="solid"
      data-contrast-guard="active"
      data-theme-tone="dark"
      data-visual-theme="slate-modern"
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <AppearanceProvider>
            <RenderedSurfaceContrastSync />
            <AccessStatusGuard>
              <FieldServiceOfflineManager />
              <MobileAppExperience />
              <MobileWorkflowEnhancer />
              <GlobalAccountMenu />
              {children}
            </AccessStatusGuard>
          </AppearanceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
