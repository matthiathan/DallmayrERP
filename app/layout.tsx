import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import './styles/index.css';
import { AuthenticationGate } from '@/components/auth/AuthenticationGate';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AppearanceProvider } from '@/components/appearance/AppearanceProvider';
import { RenderedSurfaceContrastSync } from '@/components/appearance/RenderedSurfaceContrastSync';
import { GlobalAccountMenu } from '@/components/layout/GlobalAccountMenu';
import { PageTemplateFrame } from '@/components/layout/PageTemplateFrame';
import { DALLMAYR_SA_ICON_URL } from '@/lib/brand/dallmayr';

const APPEARANCE_BOOT_SCRIPT = `
(function () {
  try {
    var raw = window.localStorage.getItem('dallmayrerp-appearance-v1');
    var saved = raw ? JSON.parse(raw) : {};
    var tone = saved.themeTone === 'dark' ? 'dark' : 'light';
    var themes = {
      dark: {
        id: 'slate-modern',
        accent: '#b89b5e',
        accentInk: '#1f1d19',
        accentOnLight: '#6f5a31',
        accentOnDark: '#d8c59b',
        theme: '#292826',
        background: '#191918',
        surface: '#242321',
        raised: '#312f2c',
        text: '#f4f1e9',
        strong: '#ffffff',
        muted: '#d2cdc2',
        subtle: '#aaa398',
        border: '#5e574b',
        link: '#d8c59b',
        track: '#302e2a'
      },
      light: {
        id: 'warm-sand',
        accent: '#b89b5e',
        accentInk: '#211d16',
        accentOnLight: '#6f5a31',
        accentOnDark: '#d8c59b',
        theme: '#ffffff',
        background: '#f5f4f1',
        surface: '#ffffff',
        raised: '#faf9f6',
        text: '#242424',
        strong: '#191918',
        muted: '#6d6a64',
        subtle: '#8f8a82',
        border: '#ddd9d1',
        link: '#6f5a31',
        track: '#e7e2d8'
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
    document.documentElement.dataset.themeTone = 'light';
    document.documentElement.dataset.visualTheme = 'warm-sand';
    document.documentElement.dataset.backgroundStyle = 'solid';
    document.documentElement.dataset.contrastGuard = 'active';
  }
})();`;

export const metadata = {
  title: 'Dallmayr Machine Telemetry',
  description: 'Dallmayr South Africa machine and telemetry monitoring',
  applicationName: 'Dallmayr Machine Telemetry',
  icons: {
    icon: DALLMAYR_SA_ICON_URL,
    apple: DALLMAYR_SA_ICON_URL,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#b89b5e',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      data-background-style="solid"
      data-contrast-guard="active"
      data-theme-tone="light"
      data-visual-theme="warm-sand"
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
            <AuthenticationGate>
              <PageTemplateFrame />
              <GlobalAccountMenu />
              {children}
            </AuthenticationGate>
          </AppearanceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
