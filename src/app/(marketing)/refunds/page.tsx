/**
 * /refunds
 *
 * The refund and cancellation policy. Under a payment gateway the refund
 * decision is ours, so this is a commercial promise rather than a description
 * of a reseller's terms. Every number comes from `POLICY`, and the cancellation
 * behaviour is the behaviour the state machine enforces.
 *
 * LEGAL_REVIEW_REQUIRED. See docs/LIMITATIONS.md.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { OPERATOR, SELLER_OF_RECORD } from '@/config/disclosures';
import { POLICY } from '@/config/policy';

export const metadata: Metadata = {
  title: 'Refund and cancellation policy',
  description:
    'How to cancel, what happens when you do, and when we refund a payment. Plain words, no conditions hidden.',
  alternates: { canonical: '/refunds' },
};

const REFUNDS_LAST_UPDATED = '2026-09-12';

export default function RefundsPage(): React.ReactElement {
  const { customer } = POLICY.refunds;

  return (
    <div className="narrow page legal">
      <p className="eyebrow">Refunds and cancellation</p>
      <h1>Cancel any time. Refunds without an argument.</h1>
      <p className="lede">
        This is the whole policy. Last updated{' '}
        <time dateTime={REFUNDS_LAST_UPDATED}>{REFUNDS_LAST_UPDATED}</time>.
      </p>

      <section>
        <h2>Cancelling</h2>
        <ul>
          <li>
            Cancel from your <Link href="/settings/subscription">subscription page</Link>{' '}
            in one click. You never have to email anyone or explain why.
          </li>
          <li>
            Your paid features stay active until the end of the period you have already
            paid for. Your account then moves to the free plan.
          </li>
          <li>
            Nothing is deleted when you cancel. Your cases, documents, findings and
            letters stay in your account, and you can export everything at any time.
          </li>
          <li>
            You can also pause an active subscription for up to {POLICY.pause.maxDays}{' '}
            days. You are not charged while it is paused.
          </li>
        </ul>
      </section>

      <section>
        <h2>Refunds</h2>
        <ul>
          <li>
            <strong>Your first payment.</strong> If you ask within{' '}
            {customer.firstChargeWindowDays} days of the first payment on a subscription,
            monthly or yearly, we refund it in full. No conditions.
          </li>
          <li>
            <strong>A renewal.</strong> If you ask within {customer.renewalWindowDays} days
            of a renewal charge, we refund it in full and end the subscription.
          </li>
          <li>
            <strong>Later than that.</strong> Cancel and keep access to the end of the
            period; we do not refund the remainder of a period that is already under way,
            except where the law where you live requires it.
          </li>
          <li>
            <strong>If we let you down.</strong> A feature you paid for did not work, or
            we discontinue the service: we refund the unused part of what you paid,
            whatever the date.
          </li>
          <li>
            <strong>A mistaken or duplicate charge</strong> is refunded in full as soon as
            we see it.
          </li>
        </ul>
        <p>
          Refunds go back to the card you paid with. Once issued, the money usually
          reaches the card in {customer.returnBusinessDays} business days, depending on
          your bank. We confirm by email when it has been issued.
        </p>
      </section>

      <section>
        <h2>How to ask</h2>
        <p>
          Email <a href={`mailto:${OPERATOR.contactEmail ?? ''}`}>{OPERATOR.contactEmail}</a>{' '}
          from the address on your account and say which charge you mean. That is all.
          We aim to answer within two business days.
        </p>
        <p>
          If you are thinking of disputing a charge with your bank, please write to us
          first: a refund from us is faster for you than a chargeback, and it reaches
          you the same way.
        </p>
      </section>

      <section>
        <h2>On your statement</h2>
        <p>
          Charges appear as &ldquo;{SELLER_OF_RECORD.statementDescriptor}&rdquo;. Payments
          are processed by {SELLER_OF_RECORD.processorName}; the refund decision is ours,
          made under this policy.
        </p>
      </section>
    </div>
  );
}
