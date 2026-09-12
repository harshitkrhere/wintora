/**
 * Appearance: light, dark, or whatever the device says.
 *
 * The choice lives in this browser only, under one localStorage key, and is
 * expressed as `data-theme` on <html>. No choice means no attribute, and the
 * stylesheet follows `prefers-color-scheme`. public/theme.js applies the
 * saved choice before the first paint; this module is the same logic for the
 * toggle, after hydration. Keep the two in step.
 *
 * Client-only: every function here touches the document or window.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'wintora:theme';

/** Fired on window after a choice is applied, so every toggle on the page agrees. */
export const THEME_EVENT = 'wintora:theme';

/** What the browser chrome is painted; matches --bg in each theme. */
export const THEME_COLOR: Record<Theme, string> = { light: '#f6f8fc', dark: '#0b1220' };

export function readChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'dark' || value === 'light' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function effectiveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? systemTheme() : choice;
}

export function applyChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage unavailable. The attribute still applies for this page.
  }

  // The theme-color metas are written per media query for the device setting.
  // An explicit choice overrides both; "system" puts each back.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const forDark = (meta.getAttribute('media') ?? '').includes('dark');
    meta.content =
      choice === 'system' ? THEME_COLOR[forDark ? 'dark' : 'light'] : THEME_COLOR[choice];
  }

  window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }));
}
