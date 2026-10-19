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
        accent: '#0f6bff',
        accentInk: '#ffffff',
        accentOnLight: '#0758d6',
        accentOnDark: '#8fc0ff',
        theme: '#071a33',
        background: '#061426',
        surface: '#0b2039',
        raised: '#102b49',
        text: '#edf5ff',
        strong: '#ffffff',
        muted: '#b9c9da',
        subtle: '#8fa4b8',
        border: '#24445f',
        link: '#7db4ff',
        track: '#17334f'
      },
      light: {
        id: 'telemetry-light',
        accent: '#0f6bff',
        accentInk: '#ffffff',
        accentOnLight: '#0758d6',
        accentOnDark: '#8fc0ff',
        theme: '#ffffff',
        background: '#f4f7fb',
        surface: '#ffffff',
        raised: '#f8fbff',
        text: '#10233e',
        strong: '#071a33',
        muted: '#66768a',
        subtle: '#8a98a9',
        border: '#dbe4ef',
        link: '#0758d6',
        track: '#e8eef6'
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
  themeColor: '#071a33',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      data-background-style="solid"
      data-contrast-guard="active"
      data-theme-tone="light"
      data-visual-theme="telemetry-light"
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
