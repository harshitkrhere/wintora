'use client';

/**
 * The signed-in navigation: four destinations and one action.
 *
 * Rendered twice by the app shell, in two shapes: a list in the sidebar on
 * a wide screen, and a fixed bar along the bottom of a phone, where a thumb
 * can reach it (see .sidebar__nav and .tabbar in globals.css). The
 * stylesheet shows one and hides the other, so there is one place to add a
 * destination and both stay in step.
 *
 * The action is Review: bringing a document in. On the phone it is the
 * raised disc in the middle of the bar; on the sidebar it is the primary
 * button above the list. Both open the same sheet.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icons';
import { ReviewSheet } from './ReviewSheet';

const ITEMS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/cases', label: 'Cases', icon: 'cases' },
  { href: '/documents', label: 'Documents', icon: 'documents' },
  // Straight to the first settings page: /settings itself only redirects
  // there, and a hop through a redirect is a blank screen on a phone.
  { href: '/settings/subscription', label: 'Account', icon: 'user' },
];

function isCurrent(path: string, href: string): boolean {
  if (path === href || path.startsWith(`${href}/`)) return true;
  // Every settings page lights Account, and so do the billing pages: they
  // are about the account.
  if (href === '/settings/subscription') {
    return path.startsWith('/settings') || path.startsWith('/checkout') || path.startsWith('/billing');
  }
  return false;
}

export function AppNav({ variant }: { variant: 'sidebar' | 'tabbar' }): React.ReactElement {
  const path = usePathname();
  const [reviewing, setReviewing] = useState(false);
  const sheet = <ReviewSheet open={reviewing} onClose={() => setReviewing(false)} />;

  if (variant === 'tabbar') {
    const [home, cases, documents, account] = ITEMS;
    const tab = (item: (typeof ITEMS)[number] | undefined): React.ReactElement | null =>
      item === undefined ? null : (
        <Link key={item.href} href={item.href} aria-current={isCurrent(path, item.href) ? 'page' : undefined}>
          <span className="tabbar__icon">
            <Icon name={item.icon} />
          </span>
          <span>{item.label}</span>
        </Link>
      );
    return (
      <nav className="tabbar" aria-label="App">
        {tab(home)}
        {tab(cases)}
        <button
          type="button"
          className="tabbar__review"
          aria-haspopup="dialog"
          aria-expanded={reviewing}
          onClick={() => setReviewing(true)}
        >
          <span className="tabbar__disc">
            <Icon name="plus" />
          </span>
          <span>Review</span>
        </button>
        {tab(documents)}
        {tab(account)}
        {sheet}
      </nav>
    );
  }

  return (
    <nav className="sidebar__nav" aria-label="App">
      <button
        type="button"
        className="btn btn--primary sidebar__review"
        aria-haspopup="dialog"
        aria-expanded={reviewing}
        onClick={() => setReviewing(true)}
      >
        <Icon name="plus" />
        Review a document
      </button>
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} aria-current={isCurrent(path, item.href) ? 'page' : undefined}>
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
      {sheet}
    </nav>
  );
}
