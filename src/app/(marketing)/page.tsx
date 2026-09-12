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
import { POLICY } from '@/config/policy';
import { analyzeBill, headline } from '@/domain/analysis/engine';
import type { BillDocument } from '@/domain/analysis/types';
import { FindingCard } from '@/components/FindingCard';
import { Icon, type IconName } from '@/components/Icons';

const PILLARS: readonly { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'document',
    title: 'Understand',
    text: 'Upload a bill or a photo of one. We read the figures and lay them out plainly, and you confirm every number before anything else happens.',
  },
  {
    icon: 'shield',
    title: 'Check',
    text: 'A deterministic engine checks whether the line items add up, whether totals reconcile, and whether anything is repeated or dated wrong.',
  },
  {
    icon: 'arrow-right',
    title: 'Take action',
    text: 'Every finding shows the numbers behind it, so you can ask the billing office a specific question rather than a vague one.',
  },
  {
    icon: 'user',
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
        <div className="hero__badge">
          <span className="badge">Free bill checker · no account needed</span>
        </div>
        <h1>Understand your medical bills before you pay.</h1>
        <p className="lede">
          Review. Compare. Take action. Wintora checks whether the arithmetic on a
          medical bill holds together, and shows you exactly what it found.
        </p>
        <div className="hero__actions">
          <Link href="/medical-bill-checker" className="btn btn--primary btn--lg">
            Check a bill now
            <Icon name="arrow-right" />
          </Link>
          <Link href="/signup" className="btn btn--secondary btn--lg">
            Create a free account
          </Link>
        </div>
        <ul className="hero__proof" aria-label="What to expect">
          <li>{POLICY.anonymousTool.freeChecks} free checks, no account</li>
          <li>Nothing you type is kept</li>
          <li>Free plan after that, no card</li>
        </ul>
      </section>

      {/* The product, doing the thing. Sample figures in, real findings out. */}
      <section className="demo" aria-labelledby="demo-heading">
        <div className="demo__bill">
          <p className="eyebrow">Example · sample figures</p>
          <h2 id="demo-heading" className="demo__title">
            A bill as printed
          </h2>
          <div className="demo__frame">
            <div className="demo__frame-head" aria-hidden>
              <span />
              <span />
              <span />
              <b>Statement · {SAMPLE_BILL.providerName}</b>
            </div>
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
        <div className="section-intro">
          <p className="eyebrow">How it works</p>
          <h2>Four steps, and you stay in charge of every one.</h2>
        </div>
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

      <section>
        <div className="two-col">
          <div className="card">
            <p className="eyebrow">What it does</p>
            <ul className="check-list">
              {CAPABILITY_STATEMENT.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="card card--soft">
            <p className="eyebrow eyebrow--quiet">What it does not</p>
            <ul className="x-list">
              {CAPABILITY_STATEMENT.doesNot.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="muted small mt-5">
          Both lists matter equally. Knowing where a tool stops is what makes the rest of
          it worth trusting.
        </p>
      </section>

      <section>
        <div className="cta-band">
          <h2>Real people. Real answers. A clearer path forward.</h2>
          <p className="lede">
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
        </div>
      </section>
    </div>
  );
}
