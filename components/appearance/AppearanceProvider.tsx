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
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const THEME_TONES: ThemeTone[] = ['dark', 'light'];
const BACKGROUND_STYLES: BackgroundStyle[] = ['aurora', 'mesh', 'dots', 'solid'];

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  accentColor: '#d4af37',
  themeColor: '#7a4b22',
  backgroundColor: '#0d0905',
  themeTone: 'dark',
  backgroundStyle: 'aurora',
};

export const ACCENT_PRESETS = [
  { name: 'Dallmayr Gold', value: '#d4af37' },
  { name: 'Electric Blue', value: '#3b82f6' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Coral', value: '#f97360' },
  { name: 'Hot Pink', value: '#ec4899' },
] as const;

export const THEME_PRESETS = [
  { name: 'Espresso', value: '#7a4b22', tone: 'dark' as const },
  { name: 'Midnight', value: '#1e3a5f', tone: 'dark' as const },
  { name: 'Forest', value: '#24543b', tone: 'dark' as const },
  { name: 'Berry', value: '#5b2b68', tone: 'dark' as const },
  { name: 'Cloud', value: '#dbe7f3', tone: 'light' as const },
  { name: 'Sand', value: '#ead9bd', tone: 'light' as const },
] as const;

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

function validHex(value: unknown, fallback: string) {
  return typeof value === 'string' && HEX_PATTERN.test(value) ? value.toLowerCase() : fallback;
}

function normalizePreferences(value: unknown): AppearancePreferences {
  const source = value && typeof value === 'object' ? value as Partial<AppearancePreferences> : {};
  return {
    accentColor: validHex(source.accentColor, DEFAULT_APPEARANCE.accentColor),
    themeColor: validHex(source.themeColor, DEFAULT_APPEARANCE.themeColor),
    backgroundColor: validHex(source.backgroundColor, DEFAULT_APPEARANCE.backgroundColor),
    themeTone: THEME_TONES.includes(source.themeTone as ThemeTone)
      ? source.themeTone as ThemeTone
      : DEFAULT_APPEARANCE.themeTone,
    backgroundStyle: BACKGROUND_STYLES.includes(source.backgroundStyle as BackgroundStyle)
      ? source.backgroundStyle as BackgroundStyle
      : DEFAULT_APPEARANCE.backgroundStyle,
  };
}

function preferencesFromRow(row: AppearanceRow): AppearancePreferences {
  return normalizePreferences({
    accentColor: row.accent_color,
    themeColor: row.theme_color,
    backgroundColor: row.background_color,
    themeTone: row.theme_tone,
    backgroundStyle: row.background_style,
  });
}

export function applyAppearance(preferences: AppearancePreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const contrastTokens = createAppearanceContrastTokens(preferences);

  root.dataset.themeTone = preferences.themeTone;
  root.dataset.backgroundStyle = preferences.backgroundStyle;
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
    }, 500);
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
          const databasePreferences = preferencesFromRow(data as AppearanceRow);
          preferencesRef.current = databasePreferences;
          setPreferences(databasePreferences);
          storeLocally(databasePreferences);
          applyAppearance(databasePreferences);
          setStatus('saved');
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
