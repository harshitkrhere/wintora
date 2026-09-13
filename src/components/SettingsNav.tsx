/**
 * The two settings pages, as text tabs under the page title. The current
 * one is underlined in ink; the other is a quiet link. Before this the
 * second page was reachable only through a breadcrumb or the footer.
 *
 * On a phone the way out is here too: the top bar carries only the mark,
 * and Account is where a person expects to find "Sign out". The sidebar
 * has its own on a wide screen, so there it is hidden.
 */

import Link from 'next/link';
import { SignOutButton } from './SignOutButton';

const PAGES = [
  { key: 'subscription', href: '/settings/subscription', label: 'Subscription' },
  { key: 'privacy', href: '/settings/privacy', label: 'Your data' },
] as const;

export type SettingsPage = (typeof PAGES)[number]['key'];

export function SettingsNav({ current }: { current: SettingsPage }): React.ReactElement {
  return (
    <nav className="subnav" aria-label="Settings">
      {PAGES.map((page) => (
        <Link key={page.key} href={page.href} aria-current={page.key === current ? 'page' : undefined}>
          {page.label}
        </Link>
      ))}
      <span className="subnav__end">
        <SignOutButton />
      </span>
    </nav>
  );
}
