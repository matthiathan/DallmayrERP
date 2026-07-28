'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { createAppearanceContrastTokens } from '@/lib/appearance/contrast';
import { getSupabaseClient } from '@/lib/supabase/client';

export type ThemeTone = 'dark' | 'light';
export type BackgroundStyle = 'aurora' | 'mesh' | 'dots' | 'solid';

export type AppearancePreferences = {
  accentColor: string;
  themeColor: string;
  backgroundColor: string;
  themeTone: ThemeTone;
  backgroundStyle: BackgroundStyle;
};

export type CuratedAppearanceTheme = AppearancePreferences & {
  id: 'slate-modern' | 'warm-sand';
  name: string;
  modeLabel: string;
  description: string;
  preview: readonly [string, string, string];
};

type AppearanceStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

type AppearanceContextValue = {
  preferences: AppearancePreferences;
  status: AppearanceStatus;
  error: string | null;
  updatePreferences: (patch: Partial<AppearancePreferences>) => void;
  resetPreferences: () => void;
};

type AppearanceRow = {
  accent_color: string;
  theme_color: string;
  background_color: string;
  theme_tone: ThemeTone;
  background_style: BackgroundStyle;
};

const STORAGE_KEY = 'dallmayrerp-appearance-v1';
const THEME_TONES: ThemeTone[] = ['dark', 'light'];

export const CURATED_APPEARANCE_THEMES: readonly CuratedAppearanceTheme[] = [
  {
    id: 'slate-modern',
    name: 'Slate Modern',
    modeLabel: 'Dark mode',
    description: 'Calm charcoal surfaces, cyan actions and bright neutral text.',
    accentColor: '#22c3dc',
    themeColor: '#2b343d',
    backgroundColor: '#0f1419',
    themeTone: 'dark',
    backgroundStyle: 'solid',
    preview: ['#0f1419', '#2b343d', '#22c3dc'],
  },
  {
    id: 'warm-sand',
    name: 'Warm Sand',
    modeLabel: 'Light mode',
    description: 'Warm ivory workspaces, bronze actions and dark espresso text.',
    accentColor: '#a67828',
    themeColor: '#e6d7bf',
    backgroundColor: '#f5efe5',
    themeTone: 'light',
    backgroundStyle: 'solid',
    preview: ['#f5efe5', '#fffaf2', '#a67828'],
  },
] as const;

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  accentColor: CURATED_APPEARANCE_THEMES[0].accentColor,
  themeColor: CURATED_APPEARANCE_THEMES[0].themeColor,
  backgroundColor: CURATED_APPEARANCE_THEMES[0].backgroundColor,
  themeTone: CURATED_APPEARANCE_THEMES[0].themeTone,
  backgroundStyle: CURATED_APPEARANCE_THEMES[0].backgroundStyle,
};

// Retained as compatibility exports for any older components. The application UI
// now exposes the two curated themes instead of independent colour combinations.
export const ACCENT_PRESETS = CURATED_APPEARANCE_THEMES.map((theme) => ({
  name: theme.name,
  value: theme.accentColor,
})) as readonly { name: string; value: string }[];

export const THEME_PRESETS = CURATED_APPEARANCE_THEMES.map((theme) => ({
  name: theme.name,
  value: theme.themeColor,
  tone: theme.themeTone,
})) as readonly { name: string; value: string; tone: ThemeTone }[];

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

export function appearanceForTone(tone: ThemeTone): AppearancePreferences {
  const selected = CURATED_APPEARANCE_THEMES.find((theme) => theme.themeTone === tone)
    ?? CURATED_APPEARANCE_THEMES[0];

  return {
    accentColor: selected.accentColor,
    themeColor: selected.themeColor,
    backgroundColor: selected.backgroundColor,
    themeTone: selected.themeTone,
    backgroundStyle: selected.backgroundStyle,
  };
}

function normalizePreferences(value: unknown): AppearancePreferences {
  const source = value && typeof value === 'object' ? value as Partial<AppearancePreferences> : {};
  const tone = THEME_TONES.includes(source.themeTone as ThemeTone)
    ? source.themeTone as ThemeTone
    : DEFAULT_APPEARANCE.themeTone;

  return appearanceForTone(tone);
}

function preferencesFromRow(row: AppearanceRow): AppearancePreferences {
  return normalizePreferences({ themeTone: row.theme_tone });
}

function rowMatchesPreferences(row: AppearanceRow, preferences: AppearancePreferences) {
  return row.accent_color.toLowerCase() === preferences.accentColor
    && row.theme_color.toLowerCase() === preferences.themeColor
    && row.background_color.toLowerCase() === preferences.backgroundColor
    && row.theme_tone === preferences.themeTone
    && row.background_style === preferences.backgroundStyle;
}

export function applyAppearance(preferences: AppearancePreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const contrastTokens = createAppearanceContrastTokens(preferences);
  const visualTheme = preferences.themeTone === 'dark' ? 'slate-modern' : 'warm-sand';

  root.dataset.themeTone = preferences.themeTone;
  root.dataset.visualTheme = visualTheme;
  root.dataset.backgroundStyle = 'solid';
  root.dataset.contrastGuard = 'active';
  root.style.setProperty('--user-accent', preferences.accentColor);
  root.style.setProperty('--user-theme', preferences.themeColor);
  root.style.setProperty('--user-background', preferences.backgroundColor);
  root.style.setProperty('--accent-ink', contrastTokens.accentInk);
  root.style.setProperty('--accent-on-light', contrastTokens.accentOnLight);
  root.style.setProperty('--accent-on-dark', contrastTokens.accentOnDark);
  root.style.setProperty('--accent-text', contrastTokens.accentText);
  root.style.setProperty('--focus-contrast', contrastTokens.focusContrast);
  root.style.setProperty('--theme-ink', contrastTokens.themeInk);
  root.style.setProperty('--background-ink', contrastTokens.backgroundInk);
  root.style.colorScheme = preferences.themeTone;
}

function storeLocally(preferences: AppearancePreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Local persistence is an enhancement; Supabase remains the durable store.
  }
}

function readLocalPreferences() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? normalizePreferences(JSON.parse(saved)) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { businessUser } = useAuth();
  const [preferences, setPreferences] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  const [status, setStatus] = useState<AppearanceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const preferencesRef = useRef(preferences);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const localPreferences = readLocalPreferences();
    preferencesRef.current = localPreferences;
    setPreferences(localPreferences);
    applyAppearance(localPreferences);
    setHydrated(true);
  }, []);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const persistPreferences = useCallback(async (next: AppearancePreferences) => {
    if (!businessUser?.id) return;
    setStatus('saving');
    setError(null);

    const { error: saveError } = await getSupabaseClient()
      .from('user_appearance_preferences')
      .upsert({
        user_id: businessUser.id,
        accent_color: next.accentColor,
        theme_color: next.themeColor,
        background_color: next.backgroundColor,
        theme_tone: next.themeTone,
        background_style: next.backgroundStyle,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (saveError) {
      setStatus('error');
      setError(saveError.message);
      return;
    }

    setStatus('saved');
  }, [businessUser?.id]);

  const queueSave = useCallback((next: AppearancePreferences) => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      persistPreferences(next).catch((saveError) => {
        setStatus('error');
        setError(saveError instanceof Error ? saveError.message : 'Could not save appearance preferences.');
      });
    }, 300);
  }, [persistPreferences]);

  useEffect(() => {
    if (!hydrated || !businessUser?.id) return;
    let active = true;

    async function loadPreferences() {
      setStatus('loading');
      setError(null);

      try {
        const { data, error: loadError } = await getSupabaseClient()
          .from('user_appearance_preferences')
          .select('accent_color, theme_color, background_color, theme_tone, background_style')
          .eq('user_id', businessUser!.id)
          .maybeSingle();

        if (!active) return;
        if (loadError) {
          setStatus('error');
          setError(loadError.message);
          return;
        }

        if (data) {
          const row = data as AppearanceRow;
          const databasePreferences = preferencesFromRow(row);
          preferencesRef.current = databasePreferences;
          setPreferences(databasePreferences);
          storeLocally(databasePreferences);
          applyAppearance(databasePreferences);

          if (!rowMatchesPreferences(row, databasePreferences)) {
            await persistPreferences(databasePreferences);
          } else {
            setStatus('saved');
          }
          return;
        }

        await persistPreferences(preferencesRef.current);
      } catch (loadFailure) {
        if (!active) return;
        setStatus('error');
        setError(loadFailure instanceof Error ? loadFailure.message : 'Could not load appearance preferences.');
      }
    }

    void loadPreferences();

    return () => {
      active = false;
    };
  }, [businessUser?.id, hydrated, persistPreferences]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  const updatePreferences = useCallback((patch: Partial<AppearancePreferences>) => {
    setPreferences((current) => {
      const next = normalizePreferences({ ...current, ...patch });
      preferencesRef.current = next;
      applyAppearance(next);
      storeLocally(next);
      setStatus(businessUser?.id ? 'saving' : 'saved');
      setError(null);
      if (businessUser?.id) queueSave(next);
      return next;
    });
  }, [businessUser?.id, queueSave]);

  const resetPreferences = useCallback(() => {
    updatePreferences(DEFAULT_APPEARANCE);
  }, [updatePreferences]);

  const value = useMemo<AppearanceContextValue>(() => ({
    preferences,
    status,
    error,
    updatePreferences,
    resetPreferences,
  }), [error, preferences, resetPreferences, status, updatePreferences]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider');
  return context;
}
