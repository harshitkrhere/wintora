/**
 * The Wintora mark: two leaves whose stems meet in a W.
 *
 * Drawn as paths so it is crisp at 16px in a tab and at 200px on a landing
 * page. Teal on the left, Azure on the right, per the brand board. Swap the
 * paths for the official cut when the design file lands; the props stay.
 */

export function LeafMark({ size = 30, title = 'Wintora' }: { size?: number; title?: string }): React.ReactElement {
  const h = Math.round(size * 0.74);
  return (
    <svg
      className="brand__mark"
      width={size}
      height={h}
      viewBox="0 0 100 74"
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* left leaf */}
      <path
        d="M6 8c22 2 40 12 46 30 3 9 2 20-2 30-14-6-28-12-36-26C9 34 6 20 6 8Z"
        fill="#14BBA6"
      />
      <path d="M16 18c14 8 24 20 30 40" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      {/* right leaf */}
      <path
        d="M94 8c-22 2-40 12-46 30-3 9-2 20 2 30 14-6 28-12 36-26 5-8 8-22 8-34Z"
        fill="#2E6FAE"
      />
      <path d="M84 18c-14 8-24 20-30 40" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      {/* the W stroke */}
      <path
        d="M38 52c4 8 7 16 10 16s6-8 10-16"
        stroke="#14BBA6"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M48 52c4 8 7 16 10 16"
        stroke="#2E6FAE"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
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
