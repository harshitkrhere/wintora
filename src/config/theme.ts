/**
 * The canvas in each theme: `--bg` in globals.css, stated once for the
 * things the browser paints outside the page. The address bar takes it
 * as theme-color, and the home-screen splash takes it from the manifest.
 * Change the token and change this together.
 */

export type ThemeName = 'light' | 'dark';

export const CANVAS: Record<ThemeName, string> = {
  light: '#f4f8fa', // Ice
  dark: '#0c0d10', // Graphite
};

/**
 * One manifest per theme. A manifest cannot ask which theme the device is
 * in, so the page points the browser at the right one
 * (src/components/ManifestPointer.tsx adds the link), and the splash the OS draws on a
 * home-screen launch matches the page that follows it.
 */
export const MANIFEST_PATH: Record<ThemeName, string> = {
  light: '/manifest.webmanifest',
  dark: '/manifest-dark.webmanifest',
};
