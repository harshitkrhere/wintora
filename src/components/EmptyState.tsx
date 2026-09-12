/**
 * What a person sees when there is nothing here yet.
 *
 * An empty state has one job: make the next step obvious. So it says what
 * this space is for, what to do, and what will happen when they do it. One
 * primary action. The mark, in a soft disc, so the space is not a void; no
 * invented illustration, no cheerleading.
 */

import Link from 'next/link';
import { LeafMark } from './Logo';

export interface EmptyStateProps {
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly href: string; readonly label: string };
  readonly secondary?: { readonly href: string; readonly label: string };
  /** What will appear here once they act, so the shape of the product is visible. */
  readonly steps?: readonly string[];
  readonly compact?: boolean;
}

export function EmptyState({ title, body, action, secondary, steps, compact = false }: EmptyStateProps): React.ReactElement {
  return (
    <div className={`empty${compact ? ' empty--compact' : ''}`}>
      {!compact ? (
        <div className="empty__mark" aria-hidden>
          <span>
            <LeafMark size={40} title="" />
          </span>
        </div>
      ) : null}
      <h2 className="empty__title">{title}</h2>
      <p className="empty__body">{body}</p>
      {steps && steps.length > 0 ? (
        <ol className="steps empty__steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : null}
      {action || secondary ? (
        <div className="empty__actions">
          {action ? (
            <Link href={action.href} className="btn btn--primary">
              {action.label}
            </Link>
          ) : null}
          {secondary ? (
            <Link href={secondary.href} className="btn btn--quiet">
              {secondary.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
