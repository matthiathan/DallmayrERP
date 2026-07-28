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

export type AppearanceContrastTokens = {
  accentInk: string;
  accentOnLight: string;
  accentOnDark: string;
  accentText: string;
  focusContrast: string;
  themeInk: string;
  backgroundInk: string;
};

const DARK_INK = '#000000';
const LIGHT_INK = '#ffffff';
const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#1f242b';
const LIGHT_FOCUS_SURFACE = '#f8fafc';
const DARK_FOCUS_SURFACE = '#111827';

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

function mixHex(source: string, target: string, targetAmount: number) {
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

export function createAppearanceContrastTokens(
  preferences: ContrastPreferenceInput,
): AppearanceContrastTokens {
  const accentOnLight = ensureContrast(preferences.accentColor, LIGHT_SURFACE, 4.5);
  const accentOnDark = ensureContrast(preferences.accentColor, DARK_SURFACE, 4.5);
  const focusSurface = preferences.themeTone === 'dark' ? DARK_FOCUS_SURFACE : LIGHT_FOCUS_SURFACE;

  return {
    accentInk: readableTextOn(preferences.accentColor),
    accentOnLight,
    accentOnDark,
    accentText: preferences.themeTone === 'dark' ? accentOnDark : accentOnLight,
    focusContrast: ensureContrast(preferences.accentColor, focusSurface, 3),
    themeInk: readableTextOn(preferences.themeColor),
    backgroundInk: readableTextOn(preferences.backgroundColor),
  };
}
