import Link from 'next/link';
import type { CaseSummary } from '@/lib/cases/load';

const ATTENTION_LABEL = {
  ATTENTION: 'Worth a closer look',
  REVIEW: 'Worth confirming',
  INFO: 'Consistent',
} as const;

export function money(cents: number | null, currency: string | null): string | null {
  if (cents === null) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD' }).format(cents / 100);
}

export function CaseCard({ summary }: { summary: CaseSummary }): React.ReactElement {
  const amount = money(summary.amountCents, summary.currency);
  return (
    <Link href={`/cases/${summary.id}`} className="card" style={{ display: 'block', textDecoration: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{summary.title}</h3>
          <p className="muted small" style={{ margin: '0.25rem 0 0' }}>
            {[summary.providerName, amount, summary.statementDate].filter(Boolean).join(' · ') || 'No details yet'}
          </p>
        </div>
        <div className="small muted" style={{ textAlign: 'right' }}>
          <div>
            {summary.documentCount} document{summary.documentCount === 1 ? '' : 's'} ·{' '}
            {summary.analysisCount} check{summary.analysisCount === 1 ? '' : 's'}
          </div>
          {summary.attention !== null ? <div>{ATTENTION_LABEL[summary.attention]}</div> : null}
        </div>
      </div>
    </Link>
  );
}
