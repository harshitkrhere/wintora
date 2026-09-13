import { describe, expect, it } from 'vitest';
import { buildManifest } from '@/config/manifest';
import { CANVAS, MANIFEST_PATH } from '@/config/theme';

describe('buildManifest', () => {
  it('is one app in both themes: same identity, icons and start, different canvas', () => {
    const light = buildManifest('light');
    const dark = buildManifest('dark');
    expect(light.start_url).toBe(dark.start_url);
    expect(light.name).toBe(dark.name);
    expect(light.icons).toEqual(dark.icons);
    expect(light.background_color).toBe(CANVAS.light);
    expect(dark.background_color).toBe(CANVAS.dark);
    expect(dark.theme_color).toBe(dark.background_color);
  });

  it('serves the light manifest at the address browsers expect', () => {
    expect(MANIFEST_PATH.light).toBe('/manifest.webmanifest');
    expect(MANIFEST_PATH.dark).not.toBe(MANIFEST_PATH.light);
  });
});
