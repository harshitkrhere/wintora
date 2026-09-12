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
import { SignOutOthersButton } from '@/components/SignOutOthersButton';
import { Icon } from '@/components/Icons';

export const metadata: Metadata = { title: 'Your data', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function PrivacySettingsPage(): React.ReactElement {
  return (
    <div className="medium stack--lg page">
      <div className="page-head__text">
        <p className="eyebrow">
          Settings · <Link href="/settings/subscription">Subscription</Link>
        </p>
        <h1>Your data</h1>
        <p className="lede">
          Everything Wintora holds about you is yours to take or remove. Neither depends
          on your plan.
        </p>
      </div>

      <section className="card status-card">
        <span className="icon-tile" aria-hidden>
          <Icon name="document" />
        </span>
        <div className="status-card__body stack">
          <div>
            <h2 className="card__title">Download a copy</h2>
            <p className="muted card__last">
              A complete export of your account: cases, uploaded documents, every analysis
              and its findings, and your billing history. Requests are fulfilled within 30
              days and sent to your account email. Right now that is done by a person
              rather than automatically, which is why it is not instant.
            </p>
          </div>
          <ExportAction />
        </div>
      </section>

      <section className="card status-card">
        <span className="icon-tile" aria-hidden>
          <Icon name="lock" />
        </span>
        <div className="status-card__body stack">
          <div>
            <h2 className="card__title">Signed-in devices</h2>
            <p className="muted card__last">
              If you have signed in somewhere you no longer trust, this ends every other
              session at once. This device stays signed in. We do not keep a list of your
              devices or their locations, on purpose.
            </p>
          </div>
          <SignOutOthersButton />
        </div>
      </section>

      <section className="card card--danger status-card">
        <span className="icon-tile icon-tile--error" aria-hidden>
          <Icon name="trash" />
        </span>
        <div className="status-card__body stack">
          <div>
            <h2 className="card__title">Delete your account</h2>
            <p className="muted card__last">
              Scheduling deletion starts a {POLICY.deletion.coolingOffDays}-day cooling-off
              period during which you can change your mind. After that, your account, cases,
              documents and analyses are removed. A record that an account was deleted on
              that date is kept, along with any billing records the law requires, separated
              from your content.
            </p>
          </div>
          <DeleteAction />
        </div>
      </section>
    </div>
  );
}
