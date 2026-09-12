'use client';

/**
 * Light, dark, or the device setting.
 *
 * Two shapes. The icon button, for the header bars, flips between light and
 * dark and says which it will do. The three-way control, for the footer, also
 * offers "System", which forgets the choice and follows the device again.
 *
 * Until it has mounted it knows nothing about this browser, so it renders the
 * same neutral control the server did; the state arrives a moment later. The
 * choice itself is stored in this browser only (see src/lib/theme.ts) and is
 * applied before the first paint by public/theme.js, so a page never loads in
 * the wrong theme and then jumps.
 */

import { useEffect, useState } from 'react';
import {
  applyChoice,
  effectiveTheme,
  readChoice,
  systemTheme,
  THEME_EVENT,
  type Theme,
  type ThemeChoice,
} from '@/lib/theme';

const OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeToggle({ variant }: { variant: 'icon' | 'segmented' }): React.ReactElement {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  const [system, setSystem] = useState<Theme>('light');

  useEffect(() => {
    setChoice(readChoice());
    setSystem(systemTheme());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    // Another toggle on the page (header and footer both have one) made a
    // choice; this one follows it.
    const onTheme = (event: Event): void => setChoice((event as CustomEvent<ThemeChoice>).detail);
    window.addEventListener(THEME_EVENT, onTheme);
    return () => {
      media.removeEventListener('change', onChange);
      window.removeEventListener(THEME_EVENT, onTheme);
    };
  }, []);

  const choose = (next: ThemeChoice): void => {
    applyChoice(next);
    setChoice(next);
  };

  const effective: Theme | null = choice === null ? null : choice === 'system' ? system : effectiveTheme(choice);

  if (variant === 'icon') {
    const label =
      effective === null ? 'Switch colour theme' : effective === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    return (
      <button
        type="button"
        className="theme-toggle"
        aria-label={label}
        title={label}
        onClick={() => choose(effective === 'dark' ? 'light' : 'dark')}
      >
        {effective === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>
    );
  }

  return (
    <div className="theme-switch" role="group" aria-label="Appearance">
      <span className="theme-switch__label">Appearance</span>
      <div className="theme-switch__options">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="theme-switch__option"
            aria-pressed={choice === option.value}
            onClick={() => choose(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MoonIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}

function SunIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
