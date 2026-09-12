'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/cases', label: 'Cases' },
  { href: '/upload', label: 'Upload' },
  { href: '/settings/subscription', label: 'Settings' },
];

export function AppNav(): React.ReactElement {
  const path = usePathname();
  return (
    <nav className="app-bar__nav" aria-label="App">
      {ITEMS.map((item) => {
        const current = path === item.href || path.startsWith(`${item.href}/`) || (item.href === '/settings/subscription' && path.startsWith('/settings'));
        return (
          <Link key={item.href} href={item.href} aria-current={current ? 'page' : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
