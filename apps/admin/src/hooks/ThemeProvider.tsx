import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SITE_THEMES, type SiteSettings, type SiteTheme } from '@reviewskits/types';
import { directoryRequest } from '../services/directory';
import { ThemeContext } from './theme-context';

function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function remember(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Appearance still works when storage is unavailable. */ }
}
function theme(value: unknown): SiteTheme | null {
  if (value === 'light') return 'ruby-light';
  if (value === 'dark') return 'ruby-dark';
  return SITE_THEMES.includes(value as SiteTheme) ? value as SiteTheme : null;
}
function apply(value: SiteTheme) {
  const root = document.documentElement;
  root.dataset.theme = value;
  root.classList.toggle('light', value === 'ruby-light');
  root.classList.toggle('dark', value === 'ruby-dark');
}
const initialDefault = theme(stored('rk-site-theme')) ?? 'ruby-dark';
apply(theme(stored('rk-theme')) ?? initialDefault);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<SiteTheme | null>(() => theme(stored('rk-theme')));
  const [siteSettings, updateSettings] = useState<SiteSettings>({ defaultTheme: initialDefault, updatedAt: null });
  const setSiteSettings = useCallback((value: SiteSettings) => {
    updateSettings(value); remember('rk-site-theme', value.defaultTheme);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    directoryRequest<SiteSettings>('/site-settings', 'GET', undefined, controller.signal).then(setSiteSettings).catch(() => {});
    const refresh = () => {
      if (document.visibilityState === 'visible') directoryRequest<SiteSettings>('/site-settings').then(setSiteSettings).catch(() => {});
    };
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', refresh); };
  }, [setSiteSettings]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'rk-theme') setPreference(theme(event.newValue));
      if (event.key === 'rk-site-theme') {
        const value = theme(event.newValue);
        if (value) updateSettings((current) => ({ ...current, defaultTheme: value }));
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const effective = preference ?? siteSettings.defaultTheme;
  useEffect(() => apply(effective), [effective]);
  const toggleTheme = () => {
    const value = effective === 'ruby-dark' ? 'ruby-light' : 'ruby-dark';
    remember('rk-theme', value); setPreference(value);
  };
  const followSiteDefault = () => { remember('rk-theme', null); setPreference(null); };
  return <ThemeContext.Provider value={{
    theme: effective === 'ruby-dark' ? 'dark' : 'light', preference, siteSettings, toggleTheme, followSiteDefault, setSiteSettings,
  }}>{children}</ThemeContext.Provider>;
}
