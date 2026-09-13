/**
 * The image a shared link shows: the statement of the product, typeset, with
 * the mark. One image for the whole site; generated at build, no photography.
 *
 * Manrope is fetched from Google Fonts when the image is generated. Asked
 * without a browser user agent, Google serves TrueType, which the renderer
 * can read; woff2 it cannot. If the fetch fails, the image still renders in
 * the renderer's bundled fallback face rather than failing the route.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { MARK_BLUE, MARK_BLUE_PATH, MARK_TEAL, MARK_TEAL_PATH, MARK_VIEWBOX } from '@/components/brand-mark';

export const alt = 'Wintora. Understand your medical bills before you pay.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Font = { name: string; data: ArrayBuffer; weight: 500 | 700; style: 'normal' };

async function manrope(weight: 500 | 700): Promise<Font | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Manrope:wght@${weight}`).then((r) => r.text());
    const url = css.match(/src: url\(([^)]+)\) format\('(?:truetype|opentype)'\)/)?.[1];
    if (url === undefined) return null;
    const data = await fetch(url).then((r) => r.arrayBuffer());
    return { name: 'Manrope', data, weight, style: 'normal' };
  } catch {
    return null;
  }
}

/**
 * The renderer needs at least one font. Offline, use the face it ships with.
 * The path is built at run time so the bundler does not try to import a TTF.
 */
async function bundledFallback(): Promise<Font> {
  const file = await readFile(
    join(process.cwd(), 'node_modules', 'next', 'dist', 'compiled', '@vercel', 'og', 'noto-sans-v27-latin-regular.ttf'),
  );
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  return { name: 'Manrope', data, weight: 700, style: 'normal' };
}

export default async function Image(): Promise<ImageResponse> {
  const loaded = await Promise.all([manrope(700), manrope(500)]);
  const fonts: Font[] = loaded.filter((f): f is Font => f !== null);
  if (fonts.length === 0) fonts.push(await bundledFallback());

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: '#ffffff',
          color: '#0b2d5b',
          fontFamily: 'Manrope',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg viewBox={MARK_VIEWBOX} width={72} height={38}>
            <path d={MARK_TEAL_PATH} fill={MARK_TEAL} />
            <path d={MARK_BLUE_PATH} fill={MARK_BLUE} />
          </svg>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1.2 }}>Wintora</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 78, fontWeight: 700, lineHeight: 1.04, letterSpacing: -3, maxWidth: 980 }}>
            Understand your medical bills before you pay.
          </div>
          <div style={{ fontSize: 30, fontWeight: 500, color: '#66758a', maxWidth: 900, lineHeight: 1.35 }}>
            A free check on the arithmetic, with the numbers behind every finding.
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, fontWeight: 500, color: '#66758a' }}>wintora.online</div>
      </div>
    ),
    { ...size, fonts },
  );
}
