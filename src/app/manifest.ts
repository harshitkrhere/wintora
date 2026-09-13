/**
 * Web app manifest.
 *
 * Makes Wintora installable to a phone home screen, and gives the OS what
 * it needs to draw a splash while the app genuinely launches: the mark on
 * the Ice canvas. Inside the app the same mark is streamed as the shell's
 * fallback (src/components/Splash.tsx) while the session is looked up.
 * Neither adds delay: the OS draws its splash while the page loads, and the
 * page's own is replaced the instant the shell is ready. The product does
 * not hide a page that has already arrived for decoration.
 */

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wintora',
    short_name: 'Wintora',
    description: 'Understand your medical bills before you pay.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f4f8fa',
    theme_color: '#f4f8fa',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
