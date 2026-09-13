/**
 * The Wintora mark: two leaves whose stems meet in a W.
 *
 * Inline SVG, so it is crisp at every size, needs no request, and can be set
 * in one colour (`tone="mono"`) for places that print or that sit on colour.
 * The path data comes from public/brand/wintora-mark.svg by way of
 * `npm run brand`, which also regenerates the favicon and home-screen icons.
 *
 * The wordmark is the name set in Inter SemiBold, title case, and nothing
 * else on the site uses that face.
 */

import {
  MARK_BLUE,
  MARK_BLUE_PATH,
  MARK_HEIGHT,
  MARK_TEAL,
  MARK_TEAL_PATH,
  MARK_VIEWBOX,
  MARK_WIDTH,
} from './brand-mark';

export function LeafMark({
  size = 28,
  title = 'Wintora',
  tone = 'brand',
}: {
  /** Rendered width in CSS pixels; the height follows the mark's proportions. */
  size?: number;
  /** Accessible name. Pass an empty string when the text beside it says the name. */
  title?: string;
  tone?: 'brand' | 'mono';
}): React.ReactElement {
  const height = Math.round((size * MARK_HEIGHT) / MARK_WIDTH);
  const decorative = title === '';
  return (
    <svg
      className="brand__mark"
      viewBox={MARK_VIEWBOX}
      width={size}
      height={height}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
    >
      <path d={MARK_TEAL_PATH} fill={tone === 'mono' ? 'currentColor' : MARK_TEAL} />
      <path d={MARK_BLUE_PATH} fill={tone === 'mono' ? 'currentColor' : MARK_BLUE} />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }): React.ReactElement {
  return (
    <span className="brand" style={{ fontSize: `${size / 25}rem` }}>
      <LeafMark size={size} title="" />
      <span>Wintora</span>
    </span>
  );
}
