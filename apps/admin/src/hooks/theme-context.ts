import { createContext } from 'react';
import type { SiteSettings, SiteTheme } from '@reviewskits/types';

export type ThemeContextValue = {
  theme: 'dark' | 'light';
  preference: SiteTheme | null;
  siteSettings: SiteSettings;
  toggleTheme: () => void;
  followSiteDefault: () => void;
  setSiteSettings: (value: SiteSettings) => void;
};
export const ThemeContext = createContext<ThemeContextValue | null>(null);
