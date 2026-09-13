/**
 * The landing page.
 *
 * One statement, and the product doing the thing beside it. The sample
 * figures below are run through the real engine when the page is built, so
 * the demonstration can never say something the checker would not. No
 * fabricated numbers, testimonials, logos or urgency anywhere on this page.
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

/**
 * Fictional figures for the demonstration, in the shape of a common US
 * itemised statement. Two things are wrong with them on purpose: one charge
 * appears twice, and the printed subtotal is $150 more than the lines add up
 * to. Whatever the engine says about that is what the page shows.
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
const CHECKS = EXAMPLE.checksRun.length;

const PILLARS: readonly { title: string; text: string }[] = [
  {
    title: 'Understand',
    text: 'Upload a bill or a photo of one. The figures are read and laid out plainly, and you confirm every number before anything else happens.',
  },
  {
    title: 'Check',
    text: `${CHECKS} fixed arithmetic checks: do the lines add up, does the subtotal reconcile, is anything repeated or dated wrong. No model decides what is true.`,
  },
  {
    title: 'Take action',
    text: 'Every finding shows the numbers behind it, so you can ask the billing office a specific question rather than a vague one.',
  },
  {
    title: 'Keep the record',
    text: 'One case per bill. Documents, results and a dated timeline stay together, and you can export or delete them whenever you like.',
  },
];

function usd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function HomePage(): React.ReactElement {
  return (
    <div className="shell landing">
      <section className="hero">
        <div className="hero__copy">
          <h1>Understand your medical bills before you pay.</h1>
          <p className="lede">
            Wintora checks whether the arithmetic on a bill holds together, then shows you the
            numbers behind every finding, so you know exactly what to ask.
          </p>
          <div className="hero__actions">
            <Link href="/medical-bill-checker" className="btn btn--primary btn--lg">
              Check a bill
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
        </div>

        {/* The product, doing the thing. Sample figures in, real findings out. */}
        <div className="hero__demo" aria-labelledby="demo-heading">
          <div className="demo__frame">
            <div className="demo__frame-head">
              <span className="demo__frame-label">Sample statement</span>
              <b>{SAMPLE_BILL.providerName}</b>
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
          <h2 id="demo-heading" className="demo__title">
            {headline(EXAMPLE)}
          </h2>
          <div className="stack">
            {EXAMPLE_FINDINGS.map((finding, i) => (
              <FindingCard key={`${finding.code}-${i}`} finding={finding} />
            ))}
          </div>
          <p className="hero__demo-note">
            Example document using fictional data. Layout inspired by common healthcare billing
            documents. Not an actual patient&apos;s bill or EOB. The findings are the engine&apos;s
            real output for these figures, produced when this page was built.
          </p>
        </div>
      </section>

      <section aria-labelledby="how-heading">
        <div className="section-intro">
          <h2 id="how-heading">Four steps, and you stay in charge of every one.</h2>
        </div>
        <div className="pillars">
          {PILLARS.map((p) => (
            <div className="pillar" key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="scope-heading">
        <div className="section-intro">
          <h2 id="scope-heading">What it does, and where it stops.</h2>
          <p className="lede">Knowing where a tool stops is what makes the rest of it worth trusting.</p>
        </div>
        <div className="two-col">
          <div>
            <h3>It does</h3>
            <ul className="check-list">
              {CAPABILITY_STATEMENT.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>It does not</h3>
            <ul className="x-list">
              {CAPABILITY_STATEMENT.doesNot.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-heading">
        <div className="cta-band">
          <h2 id="cta-heading">Get a clear answer before you call or pay.</h2>
          <p className="lede">
            Every letter is a draft you review and send yourself. Wintora never contacts
            anyone on your behalf.
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
