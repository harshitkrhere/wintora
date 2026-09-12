import type { Metadata } from 'next';
import Link from 'next/link';
import { CAPABILITY_STATEMENT, GLOBAL_DISCLAIMER } from '@/config/disclaimers';
import { BILL_CHECKS, EOB_CHECKS, ENGINE_VERSION } from '@/domain/analysis/rules';

export const metadata: Metadata = {
  title: 'How the analysis works',
  description:
    'Every finding comes from fixed arithmetic rules, not a language model. Here is exactly what runs, and what it cannot tell you.',
  alternates: { canonical: '/methodology' },
};

const CHECK_DESCRIPTIONS: Record<string, string> = {
  MISSING_REQUIRED_FIELD:
    'Notes which details could not be read, and which checks were skipped as a result.',
  LINE_ITEM_SUM_MISMATCH:
    'Adds the line items and compares the result against the stated subtotal.',
  TOTAL_RECONCILIATION_MISMATCH:
    'Works the balance through from the subtotal, adjustments and payments to the amount due.',
  DUPLICATE_LINE_ITEM:
    'Finds rows identical in description, code, date and amount.',
  REPEATED_SERVICE_DESCRIPTION:
    'Finds the same service listed at different amounts.',
  QUANTITY_PRICE_MISMATCH:
    'Multiplies quantity by unit price and compares against the line total.',
  MISSING_ITEMIZATION:
    'Flags a large total supported by very little detail.',
  SERVICE_DATE_AFTER_STATEMENT_DATE:
    'Finds services dated after the statement was issued.',
  BILL_EXCEEDS_EOB_PATIENT_RESPONSIBILITY:
    'Compares the amount due against what the EOB says is your responsibility.',
  EOB_PLAN_PAYMENT_NOT_REFLECTED:
    'Checks whether an insurance payment shown on the EOB appears on the statement.',
  CHARGE_NOT_ON_EOB: 'Lists charges that could not be matched to an EOB line.',
  EOB_LINE_NOT_ON_BILL: 'Lists EOB lines that could not be matched to this statement.',
  BILLED_AMOUNT_DIFFERS_FROM_EOB:
    'Compares the amount for the same procedure code across both documents.',
};

export default function MethodologyPage(): React.ReactElement {
  return (
    <div className="narrow" style={{ paddingTop: '3rem' }}>
      <h1>How the analysis works</h1>
      <p className="lede">
        Every finding you see comes from fixed arithmetic rules run over the figures on
        your documents. A language model is never the thing that decides what is true.
      </p>

      <section>
        <h2>The order things happen in</h2>
        <ol className="stack">
          <li>
            <strong>Extraction.</strong> The text and figures are read from the document
            and turned into structured line items and totals, each with a confidence
            score.
          </li>
          <li>
            <strong>Validation.</strong> The structure is checked, and any field that
            could not be read confidently is marked as such.
          </li>
          <li>
            <strong>The rule engine.</strong> Deterministic checks run over the numbers.
            This is where every finding comes from. Given the same document it produces
            the same result, every time.
          </li>
          <li>
            <strong>Redaction.</strong> If a language model is going to be used at all,
            names, dates of birth, identification numbers, addresses and contact details
            are replaced with placeholders first.
          </li>
          <li>
            <strong>Rewording, optionally.</strong> A model may rewrite a finding to
            read more clearly. It is given the finding and its evidence and nothing
            else. It has no tools, no network access and no access to any database.
          </li>
          <li>
            <strong>Validation of the output.</strong> Anything the model writes is
            checked before you see it. Every figure must appear in the evidence. Legal
            conclusions, medical advice, accusations, guarantees and invented citations
            are rejected, and the original wording is shown instead.
          </li>
        </ol>

        <p className="notice notice--accent">
          Because findings come from the rules rather than from a model, text inside an
          uploaded document cannot influence what we report, even if that text is
          written to look like an instruction.
        </p>
      </section>

      <section>
        <h2>The checks that run</h2>
        <p className="small muted">Rule engine version {ENGINE_VERSION}.</p>

        <h3 style={{ fontSize: '1rem' }}>On a single statement</h3>
        <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.5rem' }}>
          {BILL_CHECKS.map((code) => (
            <li key={code} className="small">
              <strong>{code}</strong>
              <br />
              <span className="muted">{CHECK_DESCRIPTIONS[code]}</span>
            </li>
          ))}
        </ul>

        <h3 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>
          When comparing a statement with an EOB
        </h3>
        <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.5rem' }}>
          {EOB_CHECKS.map((code) => (
            <li key={code} className="small">
              <strong>{code}</strong>
              <br />
              <span className="muted">{CHECK_DESCRIPTIONS[code]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Confidence, and why it is shown</h2>
        <p>
          A finding is only as reliable as the figures it rests on. If a line was hard
          to read, the finding that depends on it is marked lower confidence and phrased
          as a question rather than a statement. Low-confidence items are never counted
          in a headline and never used to prompt an upgrade.
        </p>
        <p>
          Every finding shows the numbers behind it. If what you see on the page does
          not match what the finding says, the finding is wrong and you should ignore
          it. Please{' '}
          <Link href="/corrections">tell us</Link> when that happens.
        </p>
      </section>

      <section>
        <h2>What this can and cannot tell you</h2>
        <div className="two-col">
          <div>
            <h3 style={{ fontSize: '1rem' }}>It can</h3>
            <ul className="plan__features">
              {CAPABILITY_STATEMENT.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 style={{ fontSize: '1rem' }}>It cannot</h3>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.4rem' }}>
              {CAPABILITY_STATEMENT.doesNot.map((item) => (
                <li key={item} className="small muted">
                  — {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section>
        <h2>What we do with your documents</h2>
        <p>
          Documents are encrypted, stored in private storage, and readable only by you.
          They are never used to train models. If you disable optional AI processing in
          your privacy settings, the deterministic analysis still runs in full, because
          that is the part that actually finds discrepancies.
        </p>
        <p className="small">
          <Link href="/privacy">Read the privacy notice</Link> ·{' '}
          <Link href="/data-retention">How long documents are kept</Link> ·{' '}
          <Link href="/security">Security</Link>
        </p>
      </section>

      <p className="notice">{GLOBAL_DISCLAIMER}</p>
    </div>
  );
}
