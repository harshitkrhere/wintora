/**
 * /settings/privacy — export or delete everything.
 *
 * These are rights, available on every plan including expired ones, and
 * this page is where they are exercised. Until now the routes existed and
 * the page did not, which meant a right we advertised could not be reached.
 *
 * Honesty about fulfilment: a request is recorded immediately with its
 * statutory deadline. The automated fulfilment workers are not built yet, so
 * requests are completed by hand within that deadline. The page says so.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { POLICY } from '@/config/policy';
import { DeleteAction, ExportAction } from '@/components/PrivacyActions';

export const metadata: Metadata = { title: 'Your data', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function PrivacySettingsPage(): React.ReactElement {
  return (
    <div className="narrow stack--lg" style={{ paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div>
        <p className="eyebrow">
          <Link href="/settings/subscription">Settings</Link> · Your data
        </p>
        <h1>Your data</h1>
        <p className="lede">
          Everything Wintora holds about you is yours to take or remove. Neither depends
          on your plan.
        </p>
      </div>

      <section className="stack">
        <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Download a copy</h2>
        <p className="muted" style={{ margin: 0 }}>
          A complete export of your account: cases, uploaded documents, every analysis
          and its findings, and your billing history. Requests are fulfilled within 30
          days and sent to your account email. Right now that is done by a person
          rather than automatically, which is why it is not instant.
        </p>
        <ExportAction />
      </section>

      <hr />

      <section className="stack">
        <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Delete your account</h2>
        <p className="muted" style={{ margin: 0 }}>
          Scheduling deletion starts a {POLICY.deletion.coolingOffDays}-day cooling-off
          period during which you can change your mind. After that, your account, cases,
          documents and analyses are removed. A record that an account was deleted on
          that date is kept, along with any billing records the law requires, separated
          from your content.
        </p>
        <DeleteAction />
      </section>
    </div>
  );
}
