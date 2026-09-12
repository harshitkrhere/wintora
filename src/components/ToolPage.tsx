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
    <div className="shell page tool-page">
      <article>
        <header className="tool-page__intro">
          <p className="eyebrow">Free tool</p>
          <h1>{props.h1}</h1>
          {/* Block 2: the direct answer, first, in plain prose. */}
          <p className="lede">{props.directAnswer}</p>
        </header>

        {/* Block 3: the tool, inline, before any signup ask. */}
        <section aria-label="Tool" className="tool-page__tool">
          {props.tool}
        </section>

        <section>
          <h2>Who this applies to</h2>
          <div className="two-col">
            <div className="card">
              <h3>This is for you if</h3>
              <ul className="check-list">
                {props.appliesTo.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="card card--soft">
              <h3>This will not help with</h3>
              <ul className="x-list">
                {props.doesNotApplyTo.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2>What to gather first</h2>
          <ul className="check-list">
            {props.whatToGather.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Steps</h2>
          <ol className="steps">
            {props.steps.map((step) => (
              <li key={step.title}>
                <div>
                  <strong>{step.title}</strong>
                  <span className="muted">{step.detail}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Common problems</h2>
          <div className="two-col">
            {props.commonProblems.map((item) => (
              <div key={item.problem} className="card">
                <h3>{item.problem}</h3>
                <p className="small muted card__last">{item.explanation}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Questions people ask</h2>
          <div className="stack--sm">
            {props.faq.map((item) => (
              <details key={item.question} className="card accordion">
                <summary>{item.question}</summary>
                <div className="accordion__body">
                  <p className="small">{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* Block 8: sources, attributed and linked. A page with none is not
            publishable and is never marked indexable. */}
        {props.sources.length > 0 ? (
          <section>
            <h2>Where this information comes from</h2>
            <ul className="link-list">
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
          <ul className="link-list">
            {props.relatedLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </section>

        <footer className="stack tool-page__footer">
          <p className="notice">{props.disclaimer}</p>
          <p className="caption">
            Last verified: <time dateTime={props.lastVerified}>{props.lastVerified}</time>
          </p>
        </footer>
      </article>
    </div>
  );
}
