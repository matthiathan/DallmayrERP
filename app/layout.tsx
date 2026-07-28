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
    var accent = hex.test(saved.accentColor || '') ? saved.accentColor.toLowerCase() : defaults.accentColor;
    var theme = hex.test(saved.themeColor || '') ? saved.themeColor.toLowerCase() : defaults.themeColor;
    var background = hex.test(saved.backgroundColor || '') ? saved.backgroundColor.toLowerCase() : defaults.backgroundColor;
    var tone = saved.themeTone === 'light' ? 'light' : 'dark';
    var styles = ['aurora', 'mesh', 'dots', 'solid'];
    var backgroundStyle = styles.indexOf(saved.backgroundStyle) >= 0 ? saved.backgroundStyle : defaults.backgroundStyle;

    function parseColour(value) {
      return {
        red: parseInt(value.slice(1, 3), 16),
        green: parseInt(value.slice(3, 5), 16),
        blue: parseInt(value.slice(5, 7), 16)
      };
    }

    function channelToLinear(channel) {
      var normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    }

    function luminance(value) {
      var colour = parseColour(value);
      return 0.2126 * channelToLinear(colour.red)
        + 0.7152 * channelToLinear(colour.green)
        + 0.0722 * channelToLinear(colour.blue);
    }

    function contrast(foreground, surface) {
      var foregroundLuminance = luminance(foreground);
      var surfaceLuminance = luminance(surface);
      var lighter = Math.max(foregroundLuminance, surfaceLuminance);
      var darker = Math.min(foregroundLuminance, surfaceLuminance);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function channelHex(value) {
      return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    }

    function mixColour(source, target, targetAmount) {
      var sourceColour = parseColour(source);
      var targetColour = parseColour(target);
      var sourceAmount = 1 - targetAmount;
      return '#'
        + channelHex(sourceColour.red * sourceAmount + targetColour.red * targetAmount)
        + channelHex(sourceColour.green * sourceAmount + targetColour.green * targetAmount)
        + channelHex(sourceColour.blue * sourceAmount + targetColour.blue * targetAmount);
    }

    function readableText(surface) {
      return contrast('#000000', surface) >= contrast('#ffffff', surface) ? '#000000' : '#ffffff';
    }

    function ensureContrast(colour, surface, minimum) {
      if (contrast(colour, surface) >= minimum) return colour;
      var target = contrast('#000000', surface) >= contrast('#ffffff', surface) ? '#000000' : '#ffffff';
      var lower = 0;
      var upper = 1;
      var best = target;
      for (var index = 0; index < 24; index += 1) {
        var amount = (lower + upper) / 2;
        var candidate = mixColour(colour, target, amount);
        if (contrast(candidate, surface) >= minimum) {
          best = candidate;
          upper = amount;
        } else {
          lower = amount;
        }
      }
      return best;
    }

    var accentOnLight = ensureContrast(accent, '#ffffff', 4.5);
    var accentOnDark = ensureContrast(accent, '#1f242b', 4.5);
    var focusSurface = tone === 'dark' ? '#111827' : '#f8fafc';
    var root = document.documentElement;

    root.dataset.themeTone = tone;
    root.dataset.backgroundStyle = backgroundStyle;
    root.dataset.contrastGuard = 'active';
    root.style.setProperty('--user-accent', accent);
    root.style.setProperty('--user-theme', theme);
    root.style.setProperty('--user-background', background);
    root.style.setProperty('--accent-ink', readableText(accent));
    root.style.setProperty('--accent-on-light', accentOnLight);
    root.style.setProperty('--accent-on-dark', accentOnDark);
    root.style.setProperty('--accent-text', tone === 'dark' ? accentOnDark : accentOnLight);
    root.style.setProperty('--focus-contrast', ensureContrast(accent, focusSurface, 3));
    root.style.setProperty('--theme-ink', readableText(theme));
    root.style.setProperty('--background-ink', readableText(background));
    root.style.colorScheme = tone;
  } catch (error) {
    document.documentElement.dataset.themeTone = 'dark';
    document.documentElement.dataset.backgroundStyle = 'aurora';
    document.documentElement.dataset.contrastGuard = 'active';
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
      data-contrast-guard="active"
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
