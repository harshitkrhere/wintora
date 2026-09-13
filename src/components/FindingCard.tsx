/**
 * One finding, rendered the same way everywhere a finding appears: the free
 * tool, the saved analysis on a case, and the demonstration on the landing
 * page.
 *
 * The evidence is the important part. A finding a person cannot verify is a
 * finding they should not trust, so every card can show the numbers it is
 * based on, as a short ledger in words and amounts rather than as the
 * engine's field names. See docs/AI_SAFETY.md section 6.
 */

import type { Evidence, Finding, Severity } from '@/domain/analysis/types';

export const SEVERITY_LABEL: Record<Severity, string> = {
  ATTENTION: 'Worth a closer look',
  REVIEW: 'Worth confirming',
  INFO: 'For information',
};

/**
 * Field names become plain words: "printedSubtotal" reads "Printed subtotal".
 * A few keys the rules emit read better with a hand-written label.
 */
const LABELS: Record<string, string> = {
  subtotalEquals: 'Lines, added up',
  sumOfLineItems: 'Lines, added up',
  statedSubtotal: 'Subtotal, as printed',
  lineItemCount: 'Number of lines',
  statedAmountDue: 'Amount due, as printed',
  amountDue: 'Amount due',
  insurancePaidOnStatement: 'Insurance paid, per the statement',
  planPaid: 'Plan paid, per the EOB',
  missingFields: 'Not printed',
};
function words(key: string): string {
  const known = LABELS[key];
  if (known !== undefined) return known;
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function show(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map(show).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Where on the document the numbers came from, when that is a line or a page. */
function where(evidence: Evidence): string | null {
  const parts: string[] = [];
  const line = /^lineItems\[(\d+)\]$/.exec(evidence.fieldPath);
  if (line !== null) parts.push(`Line ${Number(line[1]) + 1}`);
  if (evidence.page !== undefined) parts.push(`page ${evidence.page}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function FindingCard({ finding }: { finding: Finding }): React.ReactElement {
  const modifier =
    finding.severity === 'ATTENTION'
      ? 'finding--attention'
      : finding.severity === 'REVIEW'
        ? 'finding--review'
        : '';

  return (
    <article className={`finding ${modifier}`.trim()}>
      <p
        className={`finding__severity ${
          finding.severity === 'INFO' ? 'finding__severity--info' : ''
        }`.trim()}
      >
        {SEVERITY_LABEL[finding.severity]}
      </p>
      <h3>{finding.title}</h3>
      <p>{finding.explanation}</p>

      {finding.confidence !== 'HIGH' ? (
        <p className="small muted">
          The engine is less sure about this one. Check it against the statement first.
        </p>
      ) : null}

      {finding.recommendedAction !== undefined ? (
        <p className="small">
          <strong>Suggested next step:</strong> {finding.recommendedAction}
        </p>
      ) : null}

      {/* The numbers behind the claim. A finding a user cannot verify is a
          finding a user should not trust. */}
      {finding.evidence.length > 0 ? (
        <details>
          <summary className="small">Show the numbers this is based on</summary>
          {finding.evidence.map((evidence, index) => {
            const rows: readonly (readonly [string, string])[] = [
              ...Object.entries(evidence.observed).map(([key, value]) => [words(key), show(value)] as const),
              // An expected value the observed rows already show is not a new fact.
              ...Object.entries(evidence.expected ?? {})
                .filter(([, value]) => !Object.values(evidence.observed).some((seen) => show(seen) === show(value)))
                .map(
                ([key, value]) => [key in LABELS ? words(key) : `${words(key)}, expected`, show(value)] as const,
              ),
            ];
            const place = where(evidence);
            return (
              <div key={index}>
                <dl className="evidence-ledger">
                  {rows.map(([label, value]) => (
                    <div className="evidence-ledger__row" key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {place !== null ? <p className="evidence-ledger__where">{place}</p> : null}
              </div>
            );
          })}
        </details>
      ) : null}
    </article>
  );
}
