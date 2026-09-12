#!/usr/bin/env node
/**
 * Generate every icon the site needs from the one official mark.
 *
 *   npm run brand
 *
 * Input:  public/brand/wintora-mark.png   (the leaf mark, any size, landscape ok)
 * Output: src/app/icon.png                (512×512, transparent, browser tab)
 *         src/app/apple-icon.png          (180×180, white, iOS home screen)
 *         public/brand/wintora-mark.svg   (not produced: keep the PNG as source)
 *
 * The mark is wider than it is tall, and favicons are square. It is centred
 * on a square canvas with padding rather than stretched: a squashed logo is
 * worse than a smaller one. Re-run whenever the source file changes.
 */

import { existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'public/brand/wintora-mark.png';

if (!existsSync(SOURCE)) {
  console.error(
    [
      `${SOURCE} not found.`,
      '',
      'Save the official leaf mark there (PNG, transparent background, at least',
      '512px wide), then run this again. Nothing else needs to change: the site',
      'reads the mark from that path and the icons are generated from it.',
    ].join('\n'),
  );
  process.exit(1);
}

const meta = await sharp(SOURCE).metadata();
console.log(`source: ${meta.width}×${meta.height} ${meta.format}, alpha=${meta.hasAlpha ? 'yes' : 'no'}`);

// Trim any surrounding whitespace/transparency so padding is even.
const trimmed = await sharp(SOURCE).trim().toBuffer();

async function square(size, pad, background, out) {
  const inner = Math.round(size * (1 - pad * 2));
  const content = await sharp(trimmed)
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: content, gravity: 'centre' }])
    .png()
    .toFile(out);
  console.log(`wrote ${out} (${size}×${size})`);
}

mkdirSync('src/app', { recursive: true });

// Browser tab. Transparent so it sits on any tab colour.
await square(512, 0.08, { r: 0, g: 0, b: 0, alpha: 0 }, 'src/app/icon.png');

// iOS home screen ignores transparency and rounds the corners itself, so a
// white field with a little more breathing room reads best.
await square(180, 0.14, { r: 255, g: 255, b: 255, alpha: 1 }, 'src/app/apple-icon.png');

// Web app manifest icons, for install-to-home-screen. Android shows these on
// the OS splash while the app actually launches: a real splash, no delay.
await square(512, 0.08, { r: 0, g: 0, b: 0, alpha: 0 }, 'public/brand/icon-512.png');
await square(192, 0.08, { r: 0, g: 0, b: 0, alpha: 0 }, 'public/brand/icon-192.png');
// "Maskable": the OS may crop to a circle or squircle, so the mark sits in the
// central safe zone on a solid field.
await square(512, 0.2, { r: 255, g: 255, b: 255, alpha: 1 }, 'public/brand/icon-maskable-512.png');

console.log('\nDone. Commit src/app/icon.png, src/app/apple-icon.png and public/brand/icon-*.png.');
