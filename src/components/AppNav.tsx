'use client';

/**
 * The signed-in navigation: three destinations.
 *
 * Inline pills in the top bar on a wide screen; a fixed bar along the bottom
 * of a phone, where a thumb can reach it (see .app-bar__nav in globals.css).
 * One element renders both, so there is one place to add a destination.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type IconName = 'cases' | 'upload' | 'settings';

const ITEMS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: '/cases', label: 'Cases', icon: 'cases' },
  { href: '/upload', label: 'Upload', icon: 'upload' },
  { href: '/settings/subscription', label: 'Settings', icon: 'settings' },
];

function Icon({ name }: { name: IconName }): React.ReactElement {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'cases':
      return (
        <svg {...common}>
          <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...common}>
          <path d="M12 16V5" />
          <path d="m7 10 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <path d="M4 7h8" />
          <circle cx="15.5" cy="7" r="2.5" />
          <path d="M18 7h2" />
          <path d="M4 17h2" />
          <circle cx="8.5" cy="17" r="2.5" />
          <path d="M11 17h9" />
        </svg>
      );
  }
}

export function AppNav(): React.ReactElement {
  const path = usePathname();
  return (
    <nav className="app-bar__nav" aria-label="App">
      {ITEMS.map((item) => {
        const current =
          path === item.href ||
          path.startsWith(`${item.href}/`) ||
          (item.href === '/settings/subscription' && path.startsWith('/settings'));
        return (
          <Link key={item.href} href={item.href} aria-current={current ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
