import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import './styles/index.css';
import { AccessStatusGuard } from '@/components/auth/AccessStatusGuard';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AppearanceProvider } from '@/components/appearance/AppearanceProvider';
import { RenderedSurfaceContrastSync } from '@/components/appearance/RenderedSurfaceContrastSync';
import { AuthenticatedMobileRuntime } from '@/components/layout/AuthenticatedMobileRuntime';
import { GlobalAccountMenu } from '@/components/layout/GlobalAccountMenu';
import { MobileBrowserHygiene } from '@/components/layout/MobileBrowserHygiene';
import { PageTemplateFrame } from '@/components/layout/PageTemplateFrame';

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
  title: 'Dallmayr Machine Telemetry',
  description: 'Dallmayr South Africa machine and telemetry monitoring',
  applicationName: 'Dallmayr Machine Telemetry',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent' as const,
    title: 'Dallmayr Telemetry',
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
            <MobileBrowserHygiene />
            <AccessStatusGuard>
              <PageTemplateFrame />
              <AuthenticatedMobileRuntime />
              <GlobalAccountMenu />
              {children}
            </AccessStatusGuard>
          </AppearanceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
