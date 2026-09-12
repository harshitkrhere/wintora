/**
 * Web app manifest.
 *
 * Makes Wintora installable to a phone home screen, and gives the OS what
 * it needs to draw a splash while the app genuinely launches: the mark on
 * a white field. This is the only splash screen the product has. A
 * scripted animation on the web would be hiding a page that has already
 * arrived, and the product does not add delay for decoration.
 */

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wintora',
    short_name: 'Wintora',
    description: 'Understand your medical bills before you pay.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
