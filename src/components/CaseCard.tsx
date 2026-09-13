/**
 * One case in a list, reading the way a person asks: what is this, how
 * much, where does it stand, what do I do. The whole card is the link.
 * The next step is the same one Home and the overview show, computed from
 * the case's real rows (lib/cases/next-step.ts).
 */

import Link from 'next/link';
import type { CaseSummary } from '@/lib/cases/load';
import { Icon } from './Icons';

const ATTENTION_LABEL = {
  ATTENTION: 'Worth a closer look',
  REVIEW: 'Worth confirming',
  INFO: 'Looks consistent',
} as const;

const ATTENTION_TONE = {
  ATTENTION: 'badge--warning',
  REVIEW: 'badge--info',
  INFO: 'badge--success',
} as const;

export function money(cents: number | null, currency: string | null): string | null {
  if (cents === null) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD' }).format(cents / 100);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function CaseCard({ summary }: { summary: CaseSummary }): React.ReactElement {
  const amount = money(summary.amountCents, summary.currency);
  const closed = summary.status !== 'OPEN';
  const kind = ['Medical bill', summary.statementDate, summary.memberLabel].filter(Boolean).join(' · ');

  return (
    <Link href={`/cases/${summary.id}`} className="card case-card">
      <span className="case-card__head">
        {summary.providerName ? <span className="case-card__provider">{summary.providerName}</span> : null}
        <span className="case-card__title">{summary.title}</span>
        <span className="case-card__kind">{kind}</span>
      </span>
      <span className="case-card__amount">
        {amount ?? '—'}
        <small>{amount !== null ? 'Bill total' : 'No amount yet'}</small>
      </span>
      <span className="case-card__state">
        {summary.attention !== null ? (
          <span className={`badge badge--dot ${ATTENTION_TONE[summary.attention]}`}>{ATTENTION_LABEL[summary.attention]}</span>
        ) : closed ? (
          <span className="badge badge--neutral">Closed</span>
        ) : (
          <span className="badge badge--neutral">No checks yet</span>
        )}
        <span className="small muted">
          {plural(summary.documentCount, 'document')} · {plural(summary.analysisCount, 'check')}
        </span>
      </span>
      <span className="case-card__next">
        <span className="case-card__next-text">
          <span className="case-card__next-label">{closed ? 'Status' : 'Next step'}</span>
          <span className="case-card__next-step">
            {closed ? 'Closed, kept and ready to reopen' : summary.nextStep?.label ?? 'Nothing waiting on you'}
          </span>
        </span>
        <Icon name="chevron-right" className="case-card__chevron" />
      </span>
    </Link>
  );
}
