/**
 * /privacy
 *
 * The privacy policy, describing what the software actually does with data.
 * The substance is docs/PRIVACY.md; the numbers come from `POLICY` and the
 * plan catalog so a retention window on this page is the one the sweeper
 * enforces.
 *
 * Deliberately makes no compliance claim (HIPAA, "fully compliant", "100%
 * secure"): docs/LIMITATIONS.md explains why each would be untrue.
 *
 * LEGAL_REVIEW_REQUIRED. See docs/LIMITATIONS.md.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { OPERATOR, SELLER_OF_RECORD } from '@/config/disclosures';
import { ALL_PLANS } from '@/config/plans';
import { POLICY } from '@/config/policy';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'What Wintora collects, why, where it is stored, who processes it, how long it is kept, and how to export or delete it.',
  alternates: { canonical: '/privacy' },
};

const PRIVACY_LAST_UPDATED = '2026-09-12';

/**
 * Every third party that touches personal data, with its role. Kept here
 * rather than in a database so a change is a reviewed code change.
 */
const SUBPROCESSORS: readonly {
  name: string;
  purpose: string;
  data: string;
  region: string;
  note?: string;
}[] = [
  {
    name: 'Supabase (on Amazon Web Services)',
    purpose: 'Database, authentication and private document storage',
    data: 'Account, cases, documents, extracted figures, billing references',
    region: 'AWS Asia Pacific (Seoul), ap-northeast-2',
  },
  {
    name: 'Vercel',
    purpose: 'Hosting and running the application',
    data: 'Request data in transit; short-lived request logs',
    region: 'Global edge network; functions in the United States',
  },
  {
    name: 'Vercel (Web Analytics)',
    purpose: 'Traffic measurement on the public marketing pages',
    data: 'Page, referrer and country. Cookieless; no identifier is set and no request is made from a signed-in page.',
    region: 'Global edge network',
    note: 'Runs only on the pages anyone can read without an account. Never mounted inside the signed-in product, so no case, document or account page is ever reported here.',
  },
  {
    name: SELLER_OF_RECORD.processorName,
    purpose: 'Payment processing and recurring billing',
    data: 'Email, card details (entered directly into their form), amount, currency',
    region: 'India',
    note: 'Independent controller of the card data it collects, under its own privacy policy. We never see a card number.',
  },
  {
    name: 'OpenRouter (optional)',
    purpose: 'Rephrasing a finding the rule engine already produced',
    data: 'The finding text with identifiers removed. By default no text from your document.',
    region: 'United States; routed only to model providers that do not retain or train on prompts',
  },
  {
    name: 'Azure Document Intelligence (optional)',
    purpose: 'Reading photographs and scans that have no text layer',
    data: 'The image, when this reader is configured; otherwise you type the figures yourself',
    region: 'Microsoft Azure',
  },
];

export default function PrivacyPage(): React.ReactElement {
  return (
    <div className="narrow page legal">
      <p className="eyebrow">Privacy policy</p>
      <h1>What we hold about you, and why</h1>
      <p className="lede">
        Medical bills are health information. This page says exactly what the software
        collects, where it lives, who processes it, how long it is kept, and how you get
        it out. Last updated{' '}
        <time dateTime={PRIVACY_LAST_UPDATED}>{PRIVACY_LAST_UPDATED}</time>.
      </p>

      <section>
        <h2>Who is responsible</h2>
        <p>
          {OPERATOR.tradingName}, provided by{' '}
          {OPERATOR.legalName ?? 'an individual established in India'}, is responsible for
          the data described here. Contact:{' '}
          <a href={`mailto:${OPERATOR.contactEmail ?? ''}`}>{OPERATOR.contactEmail}</a>.
        </p>
      </section>

      <section>
        <h2>What is collected</h2>
        <table>
          <caption className="sr-only">Categories of data, with examples and purpose</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Examples</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Account</td>
              <td>Email address, password (stored only as a hash), display name</td>
              <td>Signing you in</td>
            </tr>
            <tr>
              <td>Location</td>
              <td>Country (US or CA), state or province</td>
              <td>Guidance differs by jurisdiction; currency of your plan</td>
            </tr>
            <tr>
              <td>Cases and documents</td>
              <td>Bills, EOBs, statements you upload; provider name, amounts, dates, status</td>
              <td>The service itself</td>
            </tr>
            <tr>
              <td>Extracted figures</td>
              <td>Line items, totals, dates and codes as printed on your document</td>
              <td>The arithmetic checks</td>
            </tr>
            <tr>
              <td>Billing</td>
              <td>Payment-processor references, card brand and last four digits, invoices</td>
              <td>Your subscription</td>
            </tr>
            <tr>
              <td>Operational</td>
              <td>Request logs with an opaque reference (never your email), a salted hash of your IP address for abuse prevention</td>
              <td>Security and reliability</td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>Not collected:</strong> Social Security or Social Insurance numbers as a
          field, government ID documents, biometrics, precise location, contacts,
          advertising identifiers, or cross-site behavioural profiles. If an SSN or SIN
          appears inside a document you upload, it is removed before any AI processing
          and before any log is written, and it is never indexed.
        </p>
        <p>
          The free bill checker on the public site works without an account. It is
          rate-limited per browser with a signed cookie that holds a count and nothing
          else.
        </p>
      </section>

      <section>
        <h2>How it is used</h2>
        <ul>
          <li>To provide the service you asked for: reading, checking and organising your documents, and preparing drafts you review.</li>
          <li>To run your subscription and send you the receipts and notices the law requires.</li>
          <li>To keep the service secure and to prevent abuse.</li>
          <li>To answer you when you contact us.</li>
        </ul>
        <p>
          Health information is never sold, never shared for anyone else&rsquo;s
          advertising, never used to train a model, and never shared with employers,
          insurers, providers or collectors. There are no data brokers and no advertising
          trackers on this site. The public marketing pages use cookieless traffic
          measurement, listed in the table above: it records page, referrer and country,
          nothing else, and it never runs on a page you can only reach signed in.
        </p>
      </section>

      <section>
        <h2>AI, and what it never sees</h2>
        <p>
          Every finding is produced by fixed arithmetic rules, not by a language model.
          A model is used, when configured, only to rephrase a finding the rules already
          produced. By default it receives the finding with identifiers removed and no
          text from your document at all. Requests are routed only to model providers
          that do not retain or train on prompts; if none is available, you see the
          rule engine&rsquo;s own wording, which is always correct. See{' '}
          <Link href="/methodology">how the analysis works</Link>.
        </p>
      </section>

      <section id="subprocessors">
        <h2>Who processes it</h2>
        <p>
          Only what running the service requires. Each processes data on our
          instructions except where noted.
        </p>
        <table>
          <caption className="sr-only">Third parties that process personal data</caption>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Purpose</th>
              <th scope="col">Data</th>
              <th scope="col">Where</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td>{s.purpose}</td>
                <td>{s.data}</td>
                <td>
                  {s.region}
                  {s.note !== undefined ? (
                    <span className="small muted table__feature-desc">{s.note}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Your documents are stored in a private bucket in the Seoul region and served
          only through short-lived signed links to you. They are not stored in the
          United States or Canada; if that matters for you, please consider it before
          uploading.
        </p>
      </section>

      <section>
        <h2>How long it is kept</h2>
        <p>Uploaded documents are kept for the retention period of your plan, then removed:</p>
        <ul>
          {ALL_PLANS.map((plan) => {
            const days = plan.features.RETENTION_DAYS?.limitValue ?? null;
            return (
              <li key={plan.slug}>
                {plan.displayName}: {days !== null ? `${days} days` : 'unlimited'}
              </li>
            );
          })}
        </ul>
        <p>
          You get {POLICY.retention.expiryNoticeDays} days&rsquo; notice before a document
          is removed, and moving to a plan with a shorter window gives you{' '}
          {POLICY.retention.transitionDays} days and a list of what is affected first.
          Your case records, findings and letters are text and are <em>not</em> subject
          to this window: losing a plan does not erase your record of what happened.
          Cancelling or downgrading deletes nothing.
        </p>
        <p>
          Other data: account and cases until you delete them; billing records for
          seven years for tax obligations; audit and security logs for 24 months;
          request logs for 30 days; IP hashes for {POLICY.security.ipHashRetentionDays}{' '}
          days.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Available on every plan, including free and expired accounts. No plan can
          switch them off.
        </p>
        <ul>
          <li>
            <strong>See</strong> everything held about you at{' '}
            <Link href="/settings/privacy">your data</Link>.
          </li>
          <li>
            <strong>Export</strong> it all: a single archive of your account, cases,
            original documents, extractions, findings, letters and billing history,
            delivered as a one-time download link, never as an email attachment. We
            fulfil export requests within 30 days, and usually much sooner.
          </li>
          <li>
            <strong>Correct</strong> anything by editing it in the application.
          </li>
          <li>
            <strong>Delete</strong> your account and everything in it. There is a{' '}
            {POLICY.deletion.coolingOffDays}-day cooling-off period during which you can
            cancel the deletion. What survives is stated up front: billing records
            required for tax, reduced to the minimum and disconnected from your case
            content; security events involving fraud or abuse; and a record that an
            account was deleted on a given date. Your subscription is cancelled as part
            of deletion so a deleted account is never charged again.
          </li>
          <li>
            <strong>Restrict or object</strong>: you can pause AI processing while
            keeping your data, from the same page.
          </li>
        </ul>
        <p>
          Export and deletion ask you to sign in again first. If you are in Canada, the
          United States, or anywhere else with a privacy law that gives you rights we
          have not listed, you have them too; write to us and we will honour them. Card
          data held by {SELLER_OF_RECORD.processorName} is under their control, and a
          request about it may need to go to them as well; their policy is at{' '}
          <a href={SELLER_OF_RECORD.privacyUrl} rel="noopener noreferrer">
            {SELLER_OF_RECORD.privacyUrl}
          </a>
          .
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Every row of data is protected by database-level access rules so that a bug
          in the application still cannot show one person another&rsquo;s data.
          Documents are scanned for unsafe structure before they are read, stored
          privately, and served only through links that expire in minutes. Passwords are
          never stored, only hashed. Sensitive actions require signing in again. We do
          not claim that any of this makes the service &ldquo;fully compliant&rdquo; or
          &ldquo;100% secure&rdquo;; it means the controls exist, and if we ever learn of
          a breach affecting your data we will tell you promptly and plainly.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>The service is for adults. We do not knowingly collect information from anyone under 18.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          When this policy changes in substance we update the date at the top and, for a
          change that affects how your data is used, email account holders before it takes
          effect.
        </p>
      </section>
    </div>
  );
}
