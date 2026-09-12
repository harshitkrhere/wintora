/**
 * One case in a list: its name, what is known about the bill, and where the
 * last check left it. The whole card is the link.
 */

import Link from 'next/link';
import type { CaseSummary } from '@/lib/cases/load';
import { Icon } from './Icons';

const ATTENTION_LABEL = {
  ATTENTION: 'Worth a closer look',
  REVIEW: 'Worth confirming',
  INFO: 'Consistent',
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

export function CaseCard({ summary }: { summary: CaseSummary }): React.ReactElement {
  const amount = money(summary.amountCents, summary.currency);
  const details = [summary.providerName, amount, summary.statementDate].filter(Boolean);
  const closed = summary.status !== 'OPEN';

  return (
    <Link href={`/cases/${summary.id}`} className="card case-card">
      <span className={`icon-tile ${closed ? 'icon-tile--neutral' : ''}`} aria-hidden>
        <Icon name="document" />
      </span>
      <span className="case-card__body">
        <span className="case-card__title">{summary.title}</span>
        <span className="case-card__meta">
          {details.length > 0 ? details.join(' · ') : 'No details yet'}
        </span>
        <span className="case-card__counts">
          {summary.documentCount} document{summary.documentCount === 1 ? '' : 's'} ·{' '}
          {summary.analysisCount} check{summary.analysisCount === 1 ? '' : 's'}
        </span>
      </span>
      <span className="case-card__end">
        {summary.attention !== null ? (
          <span className={`badge ${ATTENTION_TONE[summary.attention]}`}>{ATTENTION_LABEL[summary.attention]}</span>
        ) : closed ? (
          <span className="badge badge--neutral">Closed</span>
        ) : (
          <span className="badge badge--neutral">No checks yet</span>
        )}
        <Icon name="chevron-right" className="case-card__chevron" />
      </span>
    </Link>
  );
}
