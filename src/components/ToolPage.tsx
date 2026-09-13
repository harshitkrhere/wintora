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
import { POLICY } from '@/config/policy';
import { Icon } from './Icons';

export interface SourceRef {
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly tier: number;
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
  /** An anchor, so a sentence elsewhere on the site can point at this answer. */
  readonly id?: string;
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
  /** One line above the tool: a preparation note, not a checklist. */
  readonly beforeTool?: React.ReactNode;
}

export function ToolPage(props: ToolPageProps): React.ReactElement {
  return (
    <div className="shell page landing tool-page">
      <article>
        {/* The opening: what this answers, and what to have to hand. Same shape
            as the landing hero, so a tool page reads as the product, not as a
            post about it. */}
        <header className="hero hero--page">
          <div className="hero__copy">
            <p className="eyebrow">Free tool · no account needed</p>
            <h1>{props.h1}</h1>
            {/* Block 2: the direct answer, first, in plain prose. */}
            <p className="lede">{props.directAnswer}</p>
            <ul className="hero__proof" aria-label="What to expect">
              <li>{POLICY.anonymousTool.freeChecks} free checks, no account</li>
              <li>
                <Link href="/methodology#verify">Nothing you type is kept unless you choose to save it</Link>
              </li>
              <li>
                <Link href="/methodology">Fixed checks, code public</Link>
              </li>
            </ul>
          </div>
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">Have these to hand</h2>
              <span className="icon-tile" aria-hidden>
                <Icon name="document" />
              </span>
            </div>
            <ul className="check-list">
              {props.whatToGather.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </header>

        {/* Block 3: the tool, inline, before any signup ask. */}
        <section aria-labelledby="tool-heading" className="tool-frame">
          <div className="tool-frame__head">
            <h2 id="tool-heading">The tool</h2>
            <span className="tool-frame__note">
              Runs the same fixed checks as the app. Type the figures as printed; the result shows the
              numbers behind every finding.
            </span>
          </div>
          {props.beforeTool !== undefined ? <p className="small muted m-0">{props.beforeTool}</p> : null}
          {props.tool}
        </section>

        <section aria-labelledby="who-heading">
          <div className="section-intro">
            <h2 id="who-heading">Who this is for</h2>
          </div>
          <div className="two-col">
            <div className="card">
              <h3>This is for you if</h3>
              <ul className="check-list">
                {props.appliesTo.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h3>This will not help with</h3>
              <ul className="x-list">
                {props.doesNotApplyTo.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="steps-heading">
          <div className="section-intro">
            <h2 id="steps-heading">How to go about it</h2>
          </div>
          <ol className="flow">
            {props.steps.map((step) => (
              <li className="flow__step" key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="problems-heading">
          <div className="section-intro">
            <h2 id="problems-heading">What usually explains a difference</h2>
          </div>
          <div className="two-col">
            {props.commonProblems.map((item) => (
              <div key={item.problem} className="card">
                <h3>{item.problem}</h3>
                <p className="small muted card__last">{item.explanation}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="faq-heading">
          <div className="section-intro">
            <h2 id="faq-heading">Questions people ask</h2>
          </div>
          <div className="stack--sm">
            {props.faq.map((item) => (
              <details key={item.question} id={item.id} className="card accordion">
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
          <section aria-labelledby="sources-heading">
            <div className="section-intro">
              <h2 id="sources-heading">Where this information comes from</h2>
            </div>
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
        ) : null}

        <section aria-labelledby="cta-heading">
          <div className="cta-band">
            <h2 id="cta-heading">Keep the result, and everything that follows it.</h2>
            <p className="lede">
              A free account saves the check to a case, reads the bill from a photo or PDF, and drafts
              the letter you send yourself. No card.
            </p>
            <div className="hero__actions">
              <Link href="/signup" className="btn btn--primary btn--lg">
                Create a free account
              </Link>
              {props.relatedLinks.slice(0, 2).map((link) => (
                <Link key={link.href} href={link.href} className="btn btn--quiet btn--lg">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        <footer className="stack tool-page__footer">
          <p className="notice">{props.disclaimer}</p>
          <p className="caption">
            {props.sources.length === 0
              ? 'This page describes how the tool works and makes no jurisdiction-specific claims, so it cites no external sources. '
              : ''}
            Last verified: <time dateTime={props.lastVerified}>{props.lastVerified}</time>
          </p>
        </footer>
      </article>
    </div>
  );
}
