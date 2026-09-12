/**
 * /terms
 *
 * The terms of service, in plain words. Wherever a term describes something the
 * software does (renewal, cancellation, grace, refunds, data rights, what the
 * product does and does not do) the sentence is built from the same config the
 * software enforces, so the terms cannot promise one thing while the code does
 * another.
 *
 * LEGAL_REVIEW_REQUIRED: these are the operator's own terms and have not been
 * reviewed by a lawyer. They are written to be true and modest rather than to
 * be clever. See docs/LIMITATIONS.md.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { CAPABILITY_STATEMENT, GLOBAL_DISCLAIMER } from '@/config/disclaimers';
import { OPERATOR, SELLER_OF_RECORD } from '@/config/disclosures';
import { POLICY } from '@/config/policy';

export const metadata: Metadata = {
  title: 'Terms of service',
  description:
    'The terms for using Wintora: what the service does, how subscriptions renew and cancel, refunds, your data, and our responsibilities.',
  alternates: { canonical: '/terms' },
};

/** Bumped whenever a term changes in substance. Shown on the page. */
const TERMS_LAST_UPDATED = '2026-09-12';

const operatorName = OPERATOR.legalName ?? `${OPERATOR.tradingName}, operated by an individual`;

export default function TermsPage(): React.ReactElement {
  return (
    <div className="narrow page legal">
      <p className="eyebrow">Terms of service</p>
      <h1>The terms, in plain words</h1>
      <p className="lede">
        These terms are the agreement between you and {OPERATOR.tradingName} when you use
        the website or the application. They are written to be read. Last updated{' '}
        <time dateTime={TERMS_LAST_UPDATED}>{TERMS_LAST_UPDATED}</time>.
      </p>

      <section>
        <h2>1. Who we are</h2>
        <p>
          {OPERATOR.tradingName} is provided by {operatorName}, established in India, and
          referred to below as &ldquo;we&rdquo;. Payments are processed by{' '}
          {SELLER_OF_RECORD.processorName}. Your contract for the service is with us, not
          with the payment processor. You can reach us at{' '}
          <a href={`mailto:${OPERATOR.contactEmail ?? ''}`}>{OPERATOR.contactEmail}</a>;
          see also the <Link href="/contact">contact page</Link>.
        </p>
      </section>

      <section>
        <h2>2. What the service is, and is not</h2>
        <p>{GLOBAL_DISCLAIMER}</p>
        <p>What it does:</p>
        <ul>
          {CAPABILITY_STATEMENT.does.map((line) => (
            <li key={line}>{line}.</li>
          ))}
        </ul>
        <p>What it does not do:</p>
        <ul>
          {CAPABILITY_STATEMENT.doesNot.map((line) => (
            <li key={line}>{line}.</li>
          ))}
        </ul>
        <p>
          Every finding is a check you can verify against the figures on your own
          documents. A finding is a prompt to ask a question, not a determination that
          anyone has done anything wrong. Decisions about whether and what to pay, and
          what to send to a provider or insurer, are yours.
        </p>
      </section>

      <section>
        <h2>3. Your account</h2>
        <ul>
          <li>You must be at least 18 and able to enter a contract where you live.</li>
          <li>
            The service is offered to people in the United States and Canada. Guidance
            is specific to those countries.
          </li>
          <li>
            One account per person. Keep your credentials to yourself; you are
            responsible for what happens under your login until you tell us it was
            compromised.
          </li>
          <li>
            You may upload only documents you are entitled to hold: your own bills and
            statements, or those of someone you care for with their permission.
          </li>
          <li>
            We may suspend or end an account used for abuse, fraud, unlawful activity, or
            to attack the service. We will say why unless the law prevents it.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Free and paid plans</h2>
        <p>
          The free plan is a real, permanent plan with published limits. Paid plans add
          volume and workflow features. Every limit and feature is listed on the{' '}
          <Link href="/pricing">pricing page</Link>, which is generated from the same
          rules the software enforces.
        </p>
        <ul>
          <li>
            <strong>Renewal.</strong> A paid plan renews automatically at the price you
            signed up at, monthly or yearly as you chose, until you cancel. The renewal
            date and amount are always shown on your subscription page.
          </li>
          <li>
            <strong>Cancelling.</strong> You can cancel at any time from your subscription
            page, in one click, without contacting anyone. Your paid features stay active
            until the end of the period you have paid for; your account then moves to the
            free plan. Cancelling deletes nothing.
          </li>
          <li>
            <strong>Changing plan.</strong> An upgrade takes effect immediately and you
            are charged the prorated difference for the rest of the period. A downgrade
            takes effect at the end of the current period, so you keep what you paid for.
          </li>
          <li>
            <strong>If a payment fails.</strong> Your features stay active for{' '}
            {POLICY.grace.days} days while you update your card. We tell you the amount,
            the date and exactly when access would change. If it is not resolved, your
            account moves to the free plan; nothing is deleted.
          </li>
          <li>
            <strong>Price changes.</strong> If we change a price, existing subscribers
            keep the price they signed up at until we contact them directly with notice.
          </li>
          <li>
            <strong>Taxes.</strong> The price shown is the price charged. If a sales tax
            or GST/HST applies where you live, it is shown before you pay.
          </li>
        </ul>
        <p>
          Refunds are covered by our <Link href="/refunds">refund and cancellation policy</Link>,
          which is part of these terms.
        </p>
      </section>

      <section>
        <h2>5. Your documents and your data</h2>
        <ul>
          <li>
            Your documents, cases, findings and letters are yours. We process them only
            to provide the service to you, as described in the{' '}
            <Link href="/privacy">privacy policy</Link>.
          </li>
          <li>
            We never sell your information and never share it for anyone else&rsquo;s
            advertising. No model is trained on your documents.
          </li>
          <li>
            You can export everything we hold about you, and delete your account, on
            every plan including free and expired accounts. These are rights, not
            features, and no plan can switch them off. Deletion has a{' '}
            {POLICY.deletion.coolingOffDays}-day cooling-off period during which you can
            change your mind.
          </li>
          <li>
            Uploaded documents are kept for the retention period of your plan and then
            removed, with notice beforehand. Your case records, findings and letters are
            not subject to that window.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Acceptable use</h2>
        <p>
          Do not use the service to harass anyone, to submit documents you have no right
          to, to probe or overload the systems, to reverse-engineer the service, or for
          anything unlawful where you live. Letters the service prepares are drafts for
          you to review and send yourself; you are responsible for what you send.
        </p>
      </section>

      <section>
        <h2>7. Changes to the service</h2>
        <p>
          We may add, change or remove features. If a change removes something you pay
          for, we will tell you before it takes effect and you may cancel. If we ever
          discontinue the service entirely, we will give at least 30 days&rsquo; notice,
          keep export working throughout, and refund any prepaid period you have not
          used.
        </p>
      </section>

      <section>
        <h2>8. What we are responsible for, and what we are not</h2>
        <p>
          We are responsible for providing the service as described and for handling your
          data as the privacy policy says. We are not responsible for decisions made by
          your provider, insurer, a collector or anyone else, for the outcome of a request
          or dispute, or for a bill you choose to pay or not to pay. The service can
          misread a document; that is why every extracted figure is shown to you to
          confirm before anything is analysed.
        </p>
        <p>
          To the extent the law where you live allows, our total liability to you for
          anything arising from the service is limited to the amount you paid us in the
          twelve months before the claim. Nothing in these terms limits liability that
          cannot be limited by law, or takes away rights you have as a consumer under
          the laws of your state, province or country.
        </p>
      </section>

      <section>
        <h2>9. Disputes and governing law</h2>
        <p>
          If something goes wrong, contact us first: most problems are resolved by email
          within a few days, and a refund request is handled under the refund policy.
          These terms are governed by the laws of India. If you are a consumer in the
          United States or Canada, you keep every protection the consumer laws where you
          live give you, and you may bring a claim in your local courts where those laws
          allow.
        </p>
      </section>

      <section>
        <h2>10. Changes to these terms</h2>
        <p>
          When these terms change in substance we update the date at the top and, for a
          change that affects a paid plan, email subscribers before it takes effect.
          Continuing to use the service after that date means you accept the new terms;
          if you do not, cancel and export your data at any time.
        </p>
      </section>
    </div>
  );
}
