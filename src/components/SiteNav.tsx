'use client';

/**
 * The public site's navigation.
 *
 * On a wide screen: three links and the account control, inline. On a phone
 * the three links fold into a floating menu under the header, opened by one
 * button; the account control stays in the bar. Before this existed the links
 * were simply hidden below 720px, and a phone visitor could reach the tool,
 * the methodology and the prices only through the footer.
 *
 * The menu is open for exactly one path: following a link, or the browser
 * moving to another page, changes the path and so closes it without an
 * effect. Escape closes it too. Nothing here reads cookies, so the marketing
 * pages stay static.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { AuthNav } from './AuthNav';
import { Icon } from './Icons';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
  { href: '/medical-bill-checker', label: 'Check a bill' },
  { href: '/methodology', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
] as const;

export function SiteNav(): React.ReactElement {
  const path = usePathname();
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
      </div>
      <ThemeToggle variant="icon" />
      <AuthNav />
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
