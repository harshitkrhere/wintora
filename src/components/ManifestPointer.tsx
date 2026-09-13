'use client';

/**
 * Adds the manifest link, pointed at the manifest for the theme in effect,
 * so a home-screen install gets a splash on the same canvas as the page.
 *
 * A manifest cannot ask which theme the device is in, so there is one per
 * theme (src/config/manifest.ts) and the page chooses. The link is created
 * here, after hydration, rather than rendered: React rewrites the head it
 * renders on every navigation, and a link it owns would not keep an href
 * set from outside. This one it never sees. The browser reads the manifest
 * only when it needs it (an install, a periodic update), so after hydration
 * is early enough.
 */

import { useEffect } from 'react';
import { MANIFEST_PATH } from '@/config/theme';
import { effectiveTheme, readChoice, THEME_EVENT } from '@/lib/theme';

export function ManifestPointer(): null {
  useEffect(() => {
    const point = (): void => {
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (link === null) {
        link = document.createElement('link');
        link.rel = 'manifest';
        document.head.append(link);
      }
      link.href = MANIFEST_PATH[effectiveTheme(readChoice())];
    };
    point();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener(THEME_EVENT, point);
    media.addEventListener('change', point);
    return () => {
      window.removeEventListener(THEME_EVENT, point);
      media.removeEventListener('change', point);
    };
  }, []);

  return null;
}
