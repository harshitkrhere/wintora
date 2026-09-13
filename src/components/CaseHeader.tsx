/**
 * The top of a screen inside a case: the way back to the case, then the
 * screen's own title. The same on every one of them, so the pattern is
 * learned once.
 */

import Link from 'next/link';
import { Icon } from './Icons';

export function CaseHeader({
  caseId,
  caseTitle,
  title,
  lede,
}: {
  caseId: string;
  caseTitle: string;
  title: string;
  lede?: string;
}): React.ReactElement {
  return (
    <div className="page-head__text">
      <Link href={`/cases/${caseId}`} className="backlink">
        <Icon name="chevron-left" />
        {caseTitle}
      </Link>
      <h1>{title}</h1>
      {lede !== undefined ? <p className="lede">{lede}</p> : null}
    </div>
  );
}
