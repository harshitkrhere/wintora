/**
 * The one thing to do next, as the one dark card on a screen.
 *
 * Home shows it with its button; the case overview shows it without one,
 * because there the action bar under the thumb carries the same action.
 * The quiet tone is for "nothing waiting on you", which is news but not
 * a call to do anything.
 */

import Link from 'next/link';
import { Icon } from './Icons';

export function NextStepCard({
  eyebrow,
  caseTitle,
  label,
  hint,
  action,
  tone = 'navy',
}: {
  eyebrow: string;
  caseTitle?: string;
  label: string;
  hint?: string;
  action?: { href: string; label: string };
  tone?: 'navy' | 'quiet';
}): React.ReactElement {
  return (
    <section className={`next-step${tone === 'quiet' ? ' next-step--quiet' : ''}`} aria-label={eyebrow}>
      <p className="next-step__eyebrow">{eyebrow}</p>
      {caseTitle !== undefined ? <p className="next-step__case">{caseTitle}</p> : null}
      <p className="next-step__label">{label}</p>
      {hint !== undefined ? <p className="next-step__hint">{hint}</p> : null}
      {action !== undefined ? (
        <div className="next-step__action">
          <Link href={action.href} className="btn btn--primary btn--block">
            {action.label}
            <Icon name="arrow-right" />
          </Link>
        </div>
      ) : null}
    </section>
  );
}
