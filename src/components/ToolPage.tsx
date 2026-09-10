/**
 * The public content page template.
 *
 * Every block here exists for a reason set out in docs/SEO.md section 3:
 * a direct answer above the fold, the working tool inline, honest scope,
 * concrete steps, cited sources, an FAQ, and a visible verification date.
 *
 * A page with no reviewed sources renders without a sources block and must not
 * be marked indexable. The database enforces the same rule with a CHECK
 * constraint on `content_pages`.
 */

import Link from 'next/link';

export interface SourceRef {
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly tier: number;
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export interface ToolPageProps {
  readonly h1: string;
  /** One sentence, above the fold. This is what an answer engine quotes. */
  readonly directAnswer: string;
  readonly appliesTo: readonly string[];
  readonly doesNotApplyTo: readonly string[];
  readonly whatToGather: readonly string[];
  readonly steps: readonly { title: string; detail: string }[];
  readonly commonProblems: readonly { problem: string; explanation: string }[];
  readonly faq: readonly FaqItem[];
  readonly sources: readonly SourceRef[];
  readonly relatedLinks: readonly { href: string; label: string }[];
  readonly disclaimer: string;
  readonly lastVerified: string;
  readonly tool: React.ReactNode;
}

export function ToolPage(props: ToolPageProps): React.ReactElement {
  return (
    <div className="shell" style={{ paddingTop: '3rem' }}>
      <article>
        <header style={{ marginBottom: '2.5rem' }}>
          <h1>{props.h1}</h1>
          {/* Block 2: the direct answer, first, in plain prose. */}
          <p className="lede">{props.directAnswer}</p>
        </header>

        {/* Block 3: the tool, inline, before any signup ask. */}
        <section aria-label="Tool">{props.tool}</section>

        <section>
          <h2>Who this applies to</h2>
          <div className="two-col">
            <div>
              <h3 className="small eyebrow">This is for you if</h3>
              <ul className="plan__features">
                {props.appliesTo.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="small eyebrow">This will not help with</h3>
              <ul
                className="stack"
                style={{ listStyle: 'none', padding: 0, gap: '0.4rem' }}
              >
                {props.doesNotApplyTo.map((item) => (
                  <li key={item} className="small muted">
                    — {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2>What to gather first</h2>
          <ul className="plan__features">
            {props.whatToGather.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Steps</h2>
          <ol className="stack">
            {props.steps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}.</strong> {step.detail}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Common problems</h2>
          <div className="stack">
            {props.commonProblems.map((item) => (
              <div key={item.problem} className="card">
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{item.problem}</h3>
                <p className="small" style={{ marginBottom: 0 }}>
                  {item.explanation}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Questions people ask</h2>
          <div className="stack">
            {props.faq.map((item) => (
              <details key={item.question} className="card">
                <summary style={{ fontWeight: 560, cursor: 'pointer' }}>
                  {item.question}
                </summary>
                <p className="small" style={{ margin: '0.75rem 0 0' }}>
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Block 8: sources, attributed and linked. A page with none is not
            publishable and is never marked indexable. */}
        {props.sources.length > 0 ? (
          <section>
            <h2>Where this information comes from</h2>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.6rem' }}>
              {props.sources.map((source) => (
                <li key={source.url} className="small">
                  <a href={source.url} rel="noopener nofollow">
                    {source.title}
                  </a>
                  <span className="muted"> — {source.publisher}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section>
            <p className="notice">
              This page describes how the tool works and does not make
              jurisdiction-specific claims, so it cites no external sources. Pages that
              describe a state or provincial process always do.
            </p>
          </section>
        )}

        <section>
          <h2>Related</h2>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.4rem' }}>
            {props.relatedLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </section>

        <footer className="stack">
          <p className="notice">{props.disclaimer}</p>
          <p className="small muted">
            Last verified: <time dateTime={props.lastVerified}>{props.lastVerified}</time>
          </p>
        </footer>
      </article>
    </div>
  );
}
