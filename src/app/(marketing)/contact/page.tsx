/**
 * /contact
 *
 * How to reach the operator, and what to expect. Payment reviewers and
 * customers both look for this page; it states the channel, the response
 * target, and who is behind the service, without inventing anything not yet
 * decided (a postal address appears only once `OPERATOR.postalAddress` is set).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { OPERATOR, SELLER_OF_RECORD } from '@/config/disclosures';
import { Icon } from '@/components/Icons';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach Wintora for support, billing questions, refunds, privacy requests and security reports.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage(): React.ReactElement {
  const email = OPERATOR.contactEmail ?? '';

  return (
    <div className="narrow page legal">
      <p className="eyebrow">Contact</p>
      <h1>Talk to a person</h1>
      <p className="lede">
        {OPERATOR.tradingName} is run by a small team, so you will get a reply from
        someone who can actually fix the problem. Email is the one channel, and it
        works.
      </p>

      <section>
        <div className="card status-card">
          <span className="icon-tile" aria-hidden>
            <Icon name="mail" />
          </span>
          <div className="status-card__body">
            <h2 className="card__title">Email</h2>
            <p>
              <a href={`mailto:${email}`} className="contact__email">
                {email}
              </a>
            </p>
            <p className="small muted card__last">
              We aim to answer within two business days. Include the email address on your
              account so we can find you; never include a card number or a password in an
              email.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2>What to write for</h2>
        <ul>
          <li>
            <strong>Billing and refunds</strong> — say which charge you mean. The{' '}
            <Link href="/refunds">refund policy</Link> tells you what to expect.
          </li>
          <li>
            <strong>Cancelling or changing your plan</strong> — you do not need to write:
            both are one click on your <Link href="/settings/subscription">subscription page</Link>.
          </li>
          <li>
            <strong>Your data</strong> — export and deletion are self-service under{' '}
            <Link href="/settings/privacy">your data</Link>; write if anything about them
            is unclear, or to exercise a right we have not listed in the{' '}
            <Link href="/privacy">privacy policy</Link>.
          </li>
          <li>
            <strong>A mistake in a finding</strong> — tell us the case and the line. A
            finding is arithmetic on your document, so it can be checked and, if wrong,
            fixed for everyone.
          </li>
          <li>
            <strong>Security</strong> — if you believe you have found a vulnerability,
            email the same address with &ldquo;security&rdquo; in the subject. We will
            acknowledge within two business days and will not take action against
            good-faith research.
          </li>
        </ul>
      </section>

      <section>
        <h2>Who you are dealing with</h2>
        <p>
          {OPERATOR.tradingName} is provided by{' '}
          {OPERATOR.legalName ?? 'an individual operator'} established in India, serving
          people in the United States and Canada. Payments are processed by{' '}
          {SELLER_OF_RECORD.processorName} and appear on your statement as
          &ldquo;{SELLER_OF_RECORD.statementDescriptor}&rdquo;.
        </p>
        {OPERATOR.postalAddress !== null ? (
          <address className="contact__address">{OPERATOR.postalAddress}</address>
        ) : null}
        <p className="small muted">
          Wintora does not give legal or medical advice and does not act for you before
          a provider, insurer or agency. For those you need a licensed professional in
          your state or province.
        </p>
      </section>
    </div>
  );
}
