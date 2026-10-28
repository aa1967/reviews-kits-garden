export const SITE_THEMES = ['ruby-dark', 'ruby-light'] as const;
export type SiteTheme = typeof SITE_THEMES[number];
export type SiteSettings = { defaultTheme: SiteTheme; updatedAt: string | null };

export type BusinessLifecycle = {
  permanentlyClosed: boolean;
  reviewsClosed: boolean;
  updatedAt: string;
};
