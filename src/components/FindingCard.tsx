/**
 * One finding, rendered the same way everywhere a finding appears: the free
 * tool, the saved analysis on a case, and anywhere else that comes later.
 *
 * The evidence block is the important part. A finding a person cannot verify
 * is a finding they should not trust, so every card can show the numbers it
 * is based on. See docs/AI_SAFETY.md section 6.
 */

import type { Finding, Severity } from '@/domain/analysis/types';

export const SEVERITY_LABEL: Record<Severity, string> = {
  ATTENTION: 'Worth a closer look',
  REVIEW: 'Worth confirming',
  INFO: 'For information',
};

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
        {finding.confidence !== 'HIGH' ? ` · ${finding.confidence.toLowerCase()} confidence` : ''}
      </p>
      <h3>{finding.title}</h3>
      <p>{finding.explanation}</p>

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
          <div className="evidence">
            {finding.evidence.map((evidence, index) => (
              <div key={index}>
                <span>{evidence.fieldPath}: </span>
                {Object.entries(evidence.observed).map(([key, value]) => (
                  <span key={key}>
                    {key}={String(value)}{' '}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}
