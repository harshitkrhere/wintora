'use client';

/**
 * The signed-in navigation: four destinations.
 *
 * Rendered twice by the app shell, in two shapes: a list in the sidebar on a
 * wide screen, and a fixed bar along the bottom of a phone, where a thumb can
 * reach it (see .sidebar__nav and .tabbar in globals.css). The stylesheet
 * shows one and hides the other, so there is one place to add a destination
 * and both stay in step.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icons';

const ITEMS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/cases', label: 'Cases', icon: 'cases' },
  { href: '/upload', label: 'Upload', icon: 'upload' },
  { href: '/settings/subscription', label: 'Settings', icon: 'settings' },
];

function isCurrent(path: string, href: string): boolean {
  if (path === href || path.startsWith(`${href}/`)) return true;
  // Every settings page lights the Settings destination.
  if (href === '/settings/subscription' && path.startsWith('/settings')) return true;
  // Billing pages belong to Settings too: they are about the account.
  if (href === '/settings/subscription' && (path.startsWith('/checkout') || path.startsWith('/billing'))) return true;
  return false;
}

export function AppNav({ variant }: { variant: 'sidebar' | 'tabbar' }): React.ReactElement {
  const path = usePathname();

  if (variant === 'tabbar') {
    return (
      <nav className="tabbar" aria-label="App">
        {ITEMS.map((item) => (
          <Link key={item.href} href={item.href} aria-current={isCurrent(path, item.href) ? 'page' : undefined}>
            <span className="tabbar__icon">
              <Icon name={item.icon} />
            </span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="sidebar__nav" aria-label="App">
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} aria-current={isCurrent(path, item.href) ? 'page' : undefined}>
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
