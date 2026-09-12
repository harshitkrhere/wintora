/**
 * The Wintora mark: two leaves whose stems meet in a W.
 *
 * Rendered from the official artwork at public/brand/wintora-mark.png. The
 * source is 3:2, so width and height are derived from one `size` to keep the
 * proportions the designer chose. Run `npm run brand` after replacing the
 * file to regenerate the favicon and home-screen icon from it.
 */

import Image from 'next/image';

export function LeafMark({ size = 30, title = 'Wintora' }: { size?: number; title?: string }): React.ReactElement {
  const height = Math.round(size * (2 / 3));
  return (
    <Image
      className="brand__mark"
      src="/brand/wintora-mark.png"
      alt={title}
      width={size}
      height={height}
      priority
      style={{ width: size, height }}
    />
  );
}

export function Wordmark({ size = 30 }: { size?: number }): React.ReactElement {
  return (
    <span className="brand" style={{ fontSize: `${size / 26}rem` }}>
      <LeafMark size={size} />
      <span>Wintora</span>
    </span>
  );
}
