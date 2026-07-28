type Rgb = {
  red: number;
  green: number;
  blue: number;
};

type ContrastPreferenceInput = {
  accentColor: string;
  themeColor: string;
  backgroundColor: string;
  themeTone: 'dark' | 'light';
};

export type ContentTone = 'dark' | 'light';

export type AppearanceContrastTokens = {
  accentInk: string;
  accentOnLight: string;
  accentOnDark: string;
  accentText: string;
  focusContrast: string;
  themeInk: string;
  backgroundInk: string;
  contentTone: ContentTone;
  contentSurface: string;
  contentSurfaceRaised: string;
  contentText: string;
  contentStrong: string;
  contentMuted: string;
  contentSubtle: string;
  contentBorder: string;
  contentAccentText: string;
  contentFocus: string;
  chartTrack: string;
};

const DARK_INK = '#000000';
const LIGHT_INK = '#ffffff';
const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#1f242b';
const DARK_PANEL_SURFACE = '#111827';
const DARK_PANEL_RAISED = '#1f2937';
const LIGHT_PANEL_SURFACE = '#ffffff';
const LIGHT_PANEL_RAISED = '#f8fafc';

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHex(hex: string): Rgb {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function toHex({ red, green, blue }: Rgb) {
  return `#${[red, green, blue]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function linearChannel(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string) {
  const rgb = parseHex(hex);
  return (
    0.2126 * linearChannel(rgb.red)
    + 0.7152 * linearChannel(rgb.green)
    + 0.0722 * linearChannel(rgb.blue)
  );
}

export function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mixHex(source: string, target: string, targetAmount: number) {
  const sourceRgb = parseHex(source);
  const targetRgb = parseHex(target);
  const sourceAmount = 1 - targetAmount;

  return toHex({
    red: sourceRgb.red * sourceAmount + targetRgb.red * targetAmount,
    green: sourceRgb.green * sourceAmount + targetRgb.green * targetAmount,
    blue: sourceRgb.blue * sourceAmount + targetRgb.blue * targetAmount,
  });
}

export function readableTextOn(background: string) {
  const darkRatio = contrastRatio(DARK_INK, background);
  const lightRatio = contrastRatio(LIGHT_INK, background);
  return darkRatio >= lightRatio ? DARK_INK : LIGHT_INK;
}

export function ensureContrast(color: string, background: string, minimumRatio = 4.5) {
  if (contrastRatio(color, background) >= minimumRatio) return color;

  const darkRatio = contrastRatio(DARK_INK, background);
  const lightRatio = contrastRatio(LIGHT_INK, background);
  const target = darkRatio >= lightRatio ? DARK_INK : LIGHT_INK;
  let lower = 0;
  let upper = 1;
  let best = target;

  for (let iteration = 0; iteration < 24; iteration += 1) {
    const amount = (lower + upper) / 2;
    const candidate = mixHex(color, target, amount);

    if (contrastRatio(candidate, background) >= minimumRatio) {
      best = candidate;
      upper = amount;
    } else {
      lower = amount;
    }
  }

  return best;
}

function createContentSurfaceTokens(preferences: ContrastPreferenceInput) {
  // Theme tone is a user preference, not proof that a custom colour is light or dark.
  // Blend the colours that actually shape the page, then establish a controlled panel
  // surface and its foreground as one inseparable pair.
  const paletteSurface = mixHex(preferences.themeColor, preferences.backgroundColor, 0.45);
  const contentTone: ContentTone = readableTextOn(paletteSurface) === LIGHT_INK ? 'dark' : 'light';
  const contentSurface = contentTone === 'dark'
    ? mixHex(paletteSurface, DARK_PANEL_SURFACE, 0.78)
    : mixHex(paletteSurface, LIGHT_PANEL_SURFACE, 0.9);
  const contentSurfaceRaised = contentTone === 'dark'
    ? mixHex(paletteSurface, DARK_PANEL_RAISED, 0.8)
    : mixHex(paletteSurface, LIGHT_PANEL_RAISED, 0.9);
  const contentText = readableTextOn(contentSurface);
  const mutedCandidate = contentTone === 'dark' ? '#cbd5e1' : '#475569';
  const subtleCandidate = contentTone === 'dark' ? '#aeb7c4' : '#64748b';
  const borderCandidate = contentTone === 'dark' ? '#64748b' : '#64748b';
  const chartTrack = contentTone === 'dark'
    ? mixHex(contentSurface, '#000000', 0.46)
    : mixHex(contentSurface, '#cbd5e1', 0.58);

  return {
    contentTone,
    contentSurface,
    contentSurfaceRaised,
    contentText,
    contentStrong: contentText,
    contentMuted: ensureContrast(mutedCandidate, contentSurface, 4.5),
    contentSubtle: ensureContrast(subtleCandidate, contentSurface, 4.5),
    contentBorder: ensureContrast(borderCandidate, contentSurface, 3),
    contentAccentText: ensureContrast(preferences.accentColor, contentSurface, 4.5),
    contentFocus: ensureContrast(preferences.accentColor, contentSurface, 3),
    chartTrack,
  };
}

export function createAppearanceContrastTokens(
  preferences: ContrastPreferenceInput,
): AppearanceContrastTokens {
  const accentOnLight = ensureContrast(preferences.accentColor, LIGHT_SURFACE, 4.5);
  const accentOnDark = ensureContrast(preferences.accentColor, DARK_SURFACE, 4.5);
  const contentTokens = createContentSurfaceTokens(preferences);

  return {
    accentInk: readableTextOn(preferences.accentColor),
    accentOnLight,
    accentOnDark,
    accentText: contentTokens.contentAccentText,
    focusContrast: contentTokens.contentFocus,
    themeInk: readableTextOn(preferences.themeColor),
    backgroundInk: readableTextOn(preferences.backgroundColor),
    ...contentTokens,
  };
}
