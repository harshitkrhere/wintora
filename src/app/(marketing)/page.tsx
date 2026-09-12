/**
 * The landing page.
 *
 * One promise, one demonstration, four steps, one honest paragraph about
 * limits, one action. No fabricated numbers, testimonials, logos or urgency:
 * every claim on this page is something the product can show, and the
 * demonstration is the product showing it. The sample figures below are run
 * through the real engine when the page is built, so the example can never
 * say something the checker would not.
 *
 * The first action is the free checker, not the sign-up form. A person who
 * has seen a result of their own has a reason to keep it; a person who has
 * only read about one does not.
 */

import Link from 'next/link';
import { CAPABILITY_STATEMENT } from '@/config/disclaimers';
import { analyzeBill, headline } from '@/domain/analysis/engine';
import type { BillDocument } from '@/domain/analysis/types';
import { FindingCard } from '@/components/FindingCard';

function Icon({ name }: { name: 'understand' | 'check' | 'act' | 'control' }): React.ReactElement {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'understand':
      return (
        <svg {...common} aria-hidden>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <circle cx="11.5" cy="14.5" r="2.5" />
          <path d="m13.5 16.5 2 2" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common} aria-hidden>
          <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'act':
      return (
        <svg {...common} aria-hidden>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );
    case 'control':
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
        </svg>
      );
  }
}

const PILLARS = [
  {
    icon: 'understand' as const,
    title: 'Understand',
    text: 'Upload a bill or a photo of one. We read the figures and lay them out plainly, and you confirm every number before anything else happens.',
  },
  {
    icon: 'check' as const,
    title: 'Check',
    text: 'A deterministic engine checks whether the line items add up, whether totals reconcile, and whether anything is repeated or dated wrong.',
  },
  {
    icon: 'act' as const,
    title: 'Take action',
    text: 'Every finding shows the numbers behind it, so you can ask the billing office a specific question rather than a vague one.',
  },
  {
    icon: 'control' as const,
    title: 'Feel in control',
    text: 'One case per bill. Your documents, results and timeline in one place, private to you, exportable or deletable at any time.',
  },
];

/**
 * Sample figures for the demonstration. Two things are wrong with them on
 * purpose: one charge appears twice, and the printed total is $150 more than
 * the lines add up to. Whatever the engine says about that is what the page
 * shows.
 */
const SAMPLE_BILL: BillDocument = {
  documentId: 'example',
  currency: 'USD',
  providerName: 'Example Regional Medical Center',
  statementDate: '2026-03-14',
  lineItems: [
    { index: 0, description: 'Emergency department visit, level 3', amountCents: 125000 },
    { index: 1, description: 'CT scan, abdomen, with contrast', amountCents: 218000 },
    { index: 2, description: 'CT scan, abdomen, with contrast', amountCents: 218000 },
    { index: 3, description: 'Laboratory panel', amountCents: 31000 },
  ],
  subtotalCents: 607000,
  totalCents: 607000,
  amountDueCents: 607000,
};

const EXAMPLE = analyzeBill(SAMPLE_BILL);
const EXAMPLE_FINDINGS = EXAMPLE.findings.filter((f) => f.severity !== 'INFO').slice(0, 2);

function usd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function HomePage(): React.ReactElement {
  return (
    <div className="shell">
      <section className="hero">
        <div className="hero__rule" />
        <h1>Understand your medical bills before you pay.</h1>
        <p className="lede">
          Review. Compare. Take action. Wintora checks whether the arithmetic on a
          medical bill holds together, and shows you exactly what it found.
        </p>
        <div className="hero__actions">
          <Link href="/medical-bill-checker" className="btn btn--primary btn--lg">
            Check a bill now
          </Link>
          <Link href="/signup" className="btn btn--secondary btn--lg">
            Create a free account
          </Link>
        </div>
        <p className="hero__proof">
          No account needed for your first five checks, and nothing you type is kept.
          A free account after that; no card.
        </p>
      </section>

      {/* The product, doing the thing. Sample figures in, real findings out. */}
      <section className="demo" aria-labelledby="demo-heading">
        <div className="demo__bill">
          <p className="eyebrow">Example · sample figures</p>
          <h2 id="demo-heading" className="demo__title">
            A bill as printed
          </h2>
          <div className="demo__frame">
            <table className="demo__table">
              <caption className="sr-only">Sample bill line items</caption>
              <thead>
                <tr>
                  <th scope="col">Charge</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_BILL.lineItems.map((li) => (
                  <tr key={li.index}>
                    <td>{li.description}</td>
                    <td>{usd(li.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Subtotal, as printed</td>
                  <td>{usd(SAMPLE_BILL.subtotalCents ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="small muted demo__note">
            Statement dated {SAMPLE_BILL.statementDate}. Four lines, one total, the kind of page
            that arrives in the post.
          </p>
        </div>
        <div className="demo__result">
          <p className="eyebrow">What the check finds</p>
          <h2 className="demo__title">{headline(EXAMPLE)}</h2>
          <div className="stack">
            {EXAMPLE_FINDINGS.map((finding, i) => (
              <FindingCard key={`${finding.code}-${i}`} finding={finding} />
            ))}
          </div>
          <p className="small muted demo__note">
            These findings are the engine&apos;s real output for the sample figures, produced
            when this page was built. Your bill gets the same {EXAMPLE.checksRun.length} checks.
          </p>
        </div>
      </section>

      <section>
        <div className="pillars">
          {PILLARS.map((p) => (
            <div className="pillar" key={p.title}>
              <div className="pillar__icon">
                <Icon name={p.icon} />
              </div>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ paddingTop: '4rem' }}>
        <div className="two-col" style={{ alignItems: 'start' }}>
          <div>
            <p className="eyebrow">What it does</p>
            <ul className="plan__features">
              {CAPABILITY_STATEMENT.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow" style={{ color: 'var(--ink-400)' }}>What it does not</p>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.45rem' }}>
              {CAPABILITY_STATEMENT.doesNot.map((item) => (
                <li key={item} className="small muted">
                  — {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: '1.5rem' }}>
          Both lists matter equally. Knowing where a tool stops is what makes the rest of
          it worth trusting.
        </p>
      </section>

      <section style={{ paddingTop: '3rem', textAlign: 'center' }}>
        <h2>Real people. Real answers. A clearer path forward.</h2>
        <p className="lede" style={{ marginInline: 'auto' }}>
          Private by design. Every letter is a draft you review and send yourself.
          Wintora never contacts anyone on your behalf.
        </p>
        <div className="hero__actions">
          <Link href="/medical-bill-checker" className="btn btn--primary btn--lg">
            Check your own bill
          </Link>
          <Link href="/pricing" className="btn btn--quiet btn--lg">
            See pricing
          </Link>
        </div>
      </section>
    </div>
  );
}
