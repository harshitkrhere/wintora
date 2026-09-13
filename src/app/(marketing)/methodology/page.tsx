/**
 * /methodology — how the analysis works, and how to check that it does.
 *
 * Laid out like the product, not like an article: an opening with the engine's
 * facts beside it, the pipeline as a numbered flow, every check as a card with
 * the function that runs it one click away, and the public source as the
 * proof of each claim. Nothing on this page asks to be believed.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { CAPABILITY_STATEMENT, GLOBAL_DISCLAIMER } from '@/config/disclaimers';
import { SOURCE } from '@/config/disclosures';
import { POLICY } from '@/config/policy';
import { BILL_CHECKS, EOB_CHECKS, ENGINE_VERSION } from '@/domain/analysis/rules';
import { Icon } from '@/components/Icons';

export const metadata: Metadata = {
  title: 'How the analysis works',
  description:
    'Every finding comes from fixed arithmetic rules, not a language model. Here is exactly what runs, and what it cannot tell you.',
  alternates: { canonical: '/methodology' },
};

/** A title for people, a code for the record, and the function that runs it. */
const CHECKS: Record<string, { title: string; text: string; fn: string }> = {
  MISSING_REQUIRED_FIELD: {
    title: 'Which details could not be read',
    text: 'Notes what was missing, and which checks were skipped as a result rather than guessed.',
    fn: 'checkRequiredFields',
  },
  LINE_ITEM_SUM_MISMATCH: {
    title: 'Do the line items add up?',
    text: 'Adds every line and compares the result against the subtotal the statement prints.',
    fn: 'checkLineItemSum',
  },
  TOTAL_RECONCILIATION_MISMATCH: {
    title: 'Does the balance reconcile?',
    text: 'Works from the subtotal through adjustments, tax, insurance and payments to the amount due.',
    fn: 'checkTotalReconciliation',
  },
  DUPLICATE_LINE_ITEM: {
    title: 'Is a charge listed twice?',
    text: 'Finds rows identical in description, code, date and amount. A repeat is a question, not an accusation.',
    fn: 'checkDuplicateLineItems',
  },
  REPEATED_SERVICE_DESCRIPTION: {
    title: 'Same service, different prices?',
    text: 'Finds the same description billed at different amounts on one statement.',
    fn: 'checkRepeatedDescriptions',
  },
  QUANTITY_PRICE_MISMATCH: {
    title: 'Does quantity times price match?',
    text: 'Multiplies quantity by unit price and compares against the line total, where both are printed.',
    fn: 'checkQuantityPricing',
  },
  MISSING_ITEMIZATION: {
    title: 'Is a large total unexplained?',
    text: 'Flags a big amount supported by very few lines, which is what an itemised statement request fixes.',
    fn: 'checkMissingItemization',
  },
  SERVICE_DATE_AFTER_STATEMENT_DATE: {
    title: 'Do the dates make sense?',
    text: 'Finds services dated after the statement was issued.',
    fn: 'checkDateConsistency',
  },
  BILL_EXCEEDS_EOB_PATIENT_RESPONSIBILITY: {
    title: 'Are you asked for more than the EOB says?',
    text: 'Compares the amount due against what the explanation of benefits records as your responsibility.',
    fn: 'checkPatientResponsibility',
  },
  EOB_PLAN_PAYMENT_NOT_REFLECTED: {
    title: 'Did the plan payment reach the bill?',
    text: 'Checks whether an insurance payment shown on the EOB appears on the statement.',
    fn: 'checkPlanPaymentReflected',
  },
  CHARGE_NOT_ON_EOB: {
    title: 'Charges the EOB does not mention',
    text: 'Lists statement charges that could not be matched to an EOB line, by code or by wording.',
    fn: 'checkLineCoverage',
  },
  EOB_LINE_NOT_ON_BILL: {
    title: 'EOB lines not on this statement',
    text: 'Lists EOB lines with no match here. Often normal, when one claim spans several statements.',
    fn: 'checkLineCoverage',
  },
  BILLED_AMOUNT_DIFFERS_FROM_EOB: {
    title: 'Same code, different amount?',
    text: 'Compares the billed amount for one procedure code across the two documents.',
    fn: 'checkBilledAmountAgreement',
  },
};

const PIPELINE: readonly { title: string; text: string }[] = [
  {
    title: 'Reading',
    text: 'The figures are read from the document into line items and totals, each with a confidence. You see every one before anything runs.',
  },
  {
    title: 'Confirming',
    text: 'You correct what was misread and add what was missed. The check runs on what you confirm, never on the raw read.',
  },
  {
    title: 'The rules',
    text: 'Fixed arithmetic over the confirmed figures. This is where every finding comes from. Same figures, same result, every time.',
  },
  {
    title: 'Redaction',
    text: 'If a language model is used at all, names, dates of birth, identifiers, addresses and contact details are replaced first.',
  },
  {
    title: 'Rewording, optionally',
    text: 'A model may rewrite a finding to read more clearly. It is given the finding and its evidence, nothing else, with no tools and no network.',
  },
  {
    title: 'Checking the wording',
    text: 'Every figure in the rewrite must appear in the evidence. Legal conclusions, medical advice, accusations and guarantees are rejected; the original wording is shown instead.',
  },
];

const RULES_FILE = 'src/domain/analysis/rules.ts';
const TESTS_FILE = 'tests/analysis-engine.test.ts';

const PROOFS: readonly { title: string; text: string; path: string }[] = [
  { title: 'The rules', text: 'Every check above as plain arithmetic. No model decides what is true.', path: RULES_FILE },
  { title: 'The tests', text: 'Each rule, including the cases where it must stay silent.', path: TESTS_FILE },
  {
    title: 'The free checker',
    text: 'The route behind "nothing you type is kept": figures in, result out, no write to any table.',
    path: 'src/app/api/tools/bill-check/route.ts',
  },
  { title: 'The engine', text: 'The fixed order the checks run in, and how a result is summarised.', path: 'src/domain/analysis/engine.ts' },
  { title: 'Security', text: 'What is protected and how, in the operator’s own words.', path: 'docs/SECURITY.md' },
  { title: 'Limitations', text: 'What has not been reviewed yet, and what is deliberately not claimed.', path: 'docs/LIMITATIONS.md' },
];

function CheckCard({ code }: { code: string }): React.ReactElement {
  const c = CHECKS[code] ?? { title: code, text: '', fn: '' };
  return (
    <div className="card check">
      <span className="check__title">{c.title}</span>
      <p className="check__desc">{c.text}</p>
      <span className="check__meta">
        <code>{code}</code>
        <a href={SOURCE.file(RULES_FILE)} rel="noopener noreferrer" target="_blank" className="badge badge--neutral">
          {c.fn}()
        </a>
      </span>
    </div>
  );
}

export default function MethodologyPage(): React.ReactElement {
  return (
    <div className="shell page landing tool-page">
      <header className="hero hero--page">
        <div className="hero__copy">
          <p className="eyebrow">How it works</p>
          <h1>Every finding is arithmetic you can check.</h1>
          <p className="lede">
            Wintora reads the figures, you confirm them, and {BILL_CHECKS.length + EOB_CHECKS.length}{' '}
            fixed rules compare what is printed. A language model is never the thing that decides
            what is true, and the code that does is public.
          </p>
          <div className="hero__actions">
            <Link href="/medical-bill-checker" className="btn btn--primary btn--lg">
              Check a bill
            </Link>
            <a href={SOURCE.file(RULES_FILE)} rel="noopener noreferrer" target="_blank" className="btn btn--secondary btn--lg">
              Read the rules
              <Icon name="external" />
            </a>
          </div>
          <ul className="hero__proof" aria-label="In short">
            <li>Deterministic: same figures, same result</li>
            <li>Source public, every claim linked</li>
            <li>No third-party audit yet, and it says so</li>
          </ul>
        </div>

        <div className="card">
          <div className="card__header">
            <h2 className="card__title">The engine, in five facts</h2>
            <span className="badge badge--neutral">Engine {ENGINE_VERSION}</span>
          </div>
          <div className="facts">
            <div className="facts__row">
              <span className="facts__k">Input</span>
              <span className="facts__v">The figures you confirm, in integer cents. No float ever touches money.</span>
            </div>
            <div className="facts__row">
              <span className="facts__k">Rules</span>
              <span className="facts__v">
                {BILL_CHECKS.length} on a single statement, {EOB_CHECKS.length} more against an EOB. No others exist.
              </span>
            </div>
            <div className="facts__row">
              <span className="facts__k">Output</span>
              <span className="facts__v">Findings that show the numbers they came from, so you can disagree with them.</span>
            </div>
            <div className="facts__row">
              <span className="facts__k">Model</span>
              <span className="facts__v">Optional, wording only, and switched off in your privacy settings if you prefer.</span>
            </div>
            <div className="facts__row">
              <span className="facts__k">Free checker</span>
              <span className="facts__v">
                {POLICY.anonymousTool.freeChecks} checks without an account. Nothing you type there is written anywhere.
              </span>
            </div>
          </div>
        </div>
      </header>

      <section aria-labelledby="order-heading">
        <div className="section-intro">
          <h2 id="order-heading">The order things happen in</h2>
          <p className="lede">Six steps. You are in charge of the second one, and the third is the only one that finds anything.</p>
        </div>
        <ol className="flow">
          {PIPELINE.map((step) => (
            <li className="flow__step" key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="checks-heading">
        <div className="section-intro">
          <h2 id="checks-heading">The checks that run</h2>
          <p className="lede">
            These are all of them. Each names the function that runs it in the public source, so
            you can read exactly what is compared.
          </p>
        </div>
        <h3>On a single statement</h3>
        <div className="check-grid">
          {BILL_CHECKS.map((code) => (
            <CheckCard key={code} code={code} />
          ))}
        </div>
        <h3 className="mt-6">When comparing a statement with an EOB</h3>
        <div className="check-grid">
          {EOB_CHECKS.map((code) => (
            <CheckCard key={code} code={code} />
          ))}
        </div>
      </section>

      <section aria-labelledby="confidence-heading">
        <div className="section-intro">
          <h2 id="confidence-heading">Confidence, and why it is shown</h2>
          <p className="lede">
            A finding is only as reliable as the figures it rests on, so every finding says how sure
            it is and shows the numbers behind it.
          </p>
        </div>
        <div className="levels">
          <div className="card level">
            <span className="badge badge--success">High</span>
            <span className="level__name">Every figure was confirmed by you or read cleanly</span>
            <p>Stated plainly, counted in the headline.</p>
          </div>
          <div className="card level">
            <span className="badge badge--info">Medium</span>
            <span className="level__name">A figure was read with some doubt, or matched by wording</span>
            <p>Phrased as something to confirm, and it says which figure to look at.</p>
          </div>
          <div className="card level">
            <span className="badge badge--neutral">Low</span>
            <span className="level__name">A figure was hard to read</span>
            <p>Phrased as a question. Never counted in a headline, never used to suggest a plan.</p>
          </div>
        </div>
        <p className="small muted">
          If what you see on your paperwork does not match what a finding says, the finding is wrong
          and you should ignore it. Please <Link href="/contact">tell us</Link> when that happens.
        </p>
      </section>

      <section aria-labelledby="scope-heading">
        <div className="section-intro">
          <h2 id="scope-heading">What this can and cannot tell you</h2>
        </div>
        <div className="two-col">
          <div className="card">
            <h3>It does</h3>
            <ul className="check-list">
              {CAPABILITY_STATEMENT.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3>It does not</h3>
            <ul className="x-list">
              {CAPABILITY_STATEMENT.doesNot.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="verify" aria-labelledby="verify-heading">
        <div className="section-intro">
          <h2 id="verify-heading">Verify it yourself</h2>
          <p className="lede">
            The source is public. The claims on this site are not asked to be believed; they are
            asked to be checked.
          </p>
        </div>
        <div className="link-cards">
          {PROOFS.map((p) => (
            <a key={p.path} className="card card--interactive link-card" href={SOURCE.file(p.path)} rel="noopener noreferrer" target="_blank">
              <span className="link-card__title">
                {p.title}
                <Icon name="external" />
              </span>
              <p>{p.text}</p>
            </a>
          ))}
        </div>
        <p className="small muted">
          What you will not find: a certification. There is no third-party audit yet, and this page
          does not pretend otherwise.
        </p>
      </section>

      <section aria-labelledby="docs-heading">
        <div className="card status-card">
          <span className="icon-tile" aria-hidden>
            <Icon name="lock" />
          </span>
          <div className="status-card__body">
            <h2 id="docs-heading" className="card__title">
              What happens to your documents
            </h2>
            <p className="small muted">
              Encrypted, in private storage, readable only by you, and never used to train anything.
              If you switch off optional AI processing, the deterministic analysis still runs in full,
              because that is the part that finds discrepancies.
            </p>
            <p className="small card__last">
              <Link href="/privacy">Privacy notice</Link> · <Link href="/privacy#retention">How long documents are kept</Link> ·{' '}
              <Link href="/privacy#security">Security</Link>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-heading">
        <div className="cta-band">
          <h2 id="cta-heading">See it run on your own figures.</h2>
          <p className="lede">{POLICY.anonymousTool.freeChecks} checks without an account. Nothing you type is kept.</p>
          <div className="hero__actions">
            <Link href="/medical-bill-checker" className="btn btn--primary btn--lg">
              Check a bill
            </Link>
            <Link href="/bill-vs-eob" className="btn btn--quiet btn--lg">
              Compare with an EOB
            </Link>
          </div>
        </div>
      </section>

      <footer className="tool-page__footer">
        <p className="notice">{GLOBAL_DISCLAIMER}</p>
      </footer>
    </div>
  );
}
