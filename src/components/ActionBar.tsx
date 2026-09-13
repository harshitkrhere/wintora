/**
 * The one primary action of a screen, kept where the thumb is.
 *
 * On a phone the bar sticks to the bottom of the viewport above the tab
 * bar while the page scrolls beneath it, and comes to rest in flow at the
 * end of the page, so it never covers a field. On a wide screen it is a
 * plain row of buttons. One per screen; never inside a sheet.
 */

export function ActionBar({
  children,
  secondary,
  more,
  inCard = false,
  className,
}: {
  /** The primary action: one button or link with .btn--primary. */
  children: React.ReactNode;
  /** A quieter alternative, shown at the left. */
  secondary?: React.ReactNode;
  /** A small extra control at the right, such as the More button. */
  more?: React.ReactNode;
  /** Rendered as the last thing inside a card, flush with its edges. */
  inCard?: boolean;
  /** Extra classes, such as show-narrow for a bar the wide screen does without. */
  className?: string;
}): React.ReactElement {
  const classes = ['action-bar', inCard ? 'action-bar--in-card' : null, className ?? null].filter(Boolean).join(' ');
  return (
    <div className={classes} role="group" aria-label="Actions">
      {secondary !== undefined ? <div className="action-bar__secondary">{secondary}</div> : null}
      {children}
      {more !== undefined ? <div className="action-bar__more">{more}</div> : null}
    </div>
  );
}
