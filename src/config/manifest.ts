/**
 * The web app manifest, built for a theme.
 *
 * Makes Wintora installable to a phone home screen, and gives the OS what
 * it needs to draw a splash while the app genuinely launches: the mark on
 * the canvas. Everything but the canvas colour is the same in both themes,
 * and start_url is too, so the browser sees one app whichever it fetched.
 * Inside the app the same mark is streamed as the shell's fallback
 * (src/components/Splash.tsx) while the session is looked up. Neither adds
 * delay; the product does not hide a page that has already arrived for
 * decoration.
 */

import type { MetadataRoute } from 'next';
import { CANVAS, type ThemeName } from './theme';

export function buildManifest(theme: ThemeName): MetadataRoute.Manifest {
  return {
    name: 'Wintora',
    short_name: 'Wintora',
    description: 'Understand your medical bills before you pay.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: CANVAS[theme],
    theme_color: CANVAS[theme],
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
