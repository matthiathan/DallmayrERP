'use client';

import { useLayoutEffect } from 'react';
import { useAppearance } from '@/components/appearance/AppearanceProvider';
import { createAppearanceContrastTokens } from '@/lib/appearance/contrast';

const TOKEN_PROPERTIES = {
  contentSurface: '--content-surface',
  contentSurfaceRaised: '--content-surface-raised',
  contentText: '--content-text',
  contentStrong: '--content-strong',
  contentMuted: '--content-muted',
  contentSubtle: '--content-subtle',
  contentBorder: '--content-border',
  contentAccentText: '--content-accent-text',
  contentFocus: '--content-focus',
  chartTrack: '--content-chart-track',
} as const;

export function RenderedSurfaceContrastSync() {
  const { preferences } = useAppearance();

  useLayoutEffect(() => {
    const root = document.documentElement;
    const tokens = createAppearanceContrastTokens(preferences);

    root.dataset.contentTone = tokens.contentTone;
    root.style.setProperty('--accent-text', tokens.contentAccentText);
    root.style.setProperty('--focus-contrast', tokens.contentFocus);

    for (const [tokenName, propertyName] of Object.entries(TOKEN_PROPERTIES)) {
      root.style.setProperty(propertyName, tokens[tokenName as keyof typeof TOKEN_PROPERTIES]);
    }
  }, [preferences]);

  return null;
}
