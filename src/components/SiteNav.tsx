'use client';

/**
 * The public site's navigation.
 *
 * On a wide screen: three links, a quiet way in, and the one action. On a
 * phone the three links fold into a sheet under the header, opened by one
 * button, with the way in (Sign in, or Dashboard once signed in) as a fourth
 * row; the action stays in the bar, in reach.
 *
 * The menu is open for exactly one path: following a link, or the browser
 * moving to another page, changes the path and so closes it without an
 * effect. Escape closes it too. Nothing here reads cookies, so the marketing
 * pages stay static.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { AuthNav, useSessionState } from './AuthNav';
import { Icon } from './Icons';

const LINKS = [
  { href: '/methodology', label: 'How it works' },
  { href: '/bill-vs-eob', label: 'Bill vs EOB' },
  { href: '/pricing', label: 'Pricing' },
] as const;

export function SiteNav(): React.ReactElement {
  const path = usePathname();
  const session = useSessionState();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === path;
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenFor(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <nav className="site-nav" aria-label="Main">
      <div className="site-nav__links" id={panelId} data-open={open ? 'true' : 'false'}>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={path === link.href ? 'page' : undefined}
            onClick={() => setOpenFor(null)}
          >
            {link.label}
          </Link>
        ))}
        {/* The account link again, as a row, for phones where the bar hides it. */}
        <AuthNav state={session} variant="menu" onNavigate={() => setOpenFor(null)} />
      </div>
      <AuthNav state={session} />
      <Link href="/medical-bill-checker" className="btn btn--primary site-nav__cta">
        Check a bill
      </Link>
      <button
        type="button"
        className="icon-btn site-nav__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenFor(open ? null : path)}
      >
        <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        <Icon name={open ? 'close' : 'menu'} />
      </button>
    </nav>
  );
}
