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
import { POLICY } from '@/config/policy';
import { DeleteAction, ExportAction } from '@/components/PrivacyActions';
import { SettingsNav } from '@/components/SettingsNav';
import { optionalUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { SignOutOthersButton } from '@/components/SignOutOthersButton';
import { Icon } from '@/components/Icons';

export const metadata: Metadata = { title: 'Your data', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  QUEUED: { text: 'Waiting to send', tone: 'badge--neutral' },
  SENT: { text: 'Sent', tone: 'badge--info' },
  DELAYED: { text: 'Delayed', tone: 'badge--warning' },
  DELIVERED: { text: 'Delivered', tone: 'badge--success' },
  BOUNCED: { text: 'Bounced', tone: 'badge--error' },
  COMPLAINED: { text: 'Marked as spam', tone: 'badge--error' },
  FAILED: { text: 'Could not be sent', tone: 'badge--warning' },
  SUPPRESSED: { text: 'Not sent (address bounced earlier)', tone: 'badge--neutral' },
  NO_ADDRESS: { text: 'No address on the account', tone: 'badge--neutral' },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function PrivacySettingsPage(): Promise<React.ReactElement> {
  const user = await optionalUser();
  const admin = user !== null ? createAdminClient() : null;
  const [{ data: mail }, { data: pendingExport }, { data: pendingDeletion }] =
    user !== null && admin !== null
      ? await Promise.all([
          admin
            .from('email_log')
            .select('id, kind, subject, status, created_at, sent_at, last_event_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(25),
          // What has been asked for and not yet done, so the page says so
          // instead of offering the same request again.
          admin
            .from('export_jobs')
            .select('id, created_at')
            .eq('user_id', user.id)
            .in('status', ['QUEUED', 'RUNNING'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          admin
            .from('deletion_jobs')
            .select('id, execute_after')
            .eq('user_id', user.id)
            .eq('status', 'QUEUED')
            .is('canceled_at', null)
            .maybeSingle(),
        ])
      : [{ data: [] }, { data: null }, { data: null }];
  const emails = (mail ?? []) as { id: string; kind: string; subject: string; status: string; created_at: string; sent_at: string | null; last_event_at: string | null }[];
  const exportRequestedAt = (pendingExport as { created_at: string } | null)?.created_at ?? null;
  const deletionOn = (pendingDeletion as { execute_after: string } | null)?.execute_after ?? null;

  return (
    <div className="medium stack--lg page">
      <SettingsNav current="privacy" />
      <div className="page-head__text">
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
          {exportRequestedAt !== null ? (
            <p className="notice notice--info" role="status">
              You asked for a copy on {when(exportRequestedAt)}. It will be sent to{' '}
              {user?.email ?? 'your account email'} within 30 days of that.
            </p>
          ) : null}
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

      <section className="card status-card">
        <span className="icon-tile" aria-hidden>
          <Icon name="mail" />
        </span>
        <div className="status-card__body stack">
          <div>
            <h2 className="card__title">Emails we have sent you</h2>
            <p className="muted card__last">
              Every message Wintora has sent to your address, and what became of it. None of
              them carry anything from a case; each is a fact about your account and a link. We
              do not track whether you open or click them.
            </p>
          </div>
          {emails.length === 0 ? (
            <p className="caption m-0">Nothing yet.</p>
          ) : (
            <div className="table-scroll table--responsive">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {emails.map((e) => {
                    const s = STATUS_LABEL[e.status] ?? { text: e.status, tone: 'badge--neutral' };
                    return (
                      <tr key={e.id}>
                        <td data-label="When" className="small">{when(e.sent_at ?? e.created_at)}</td>
                        <td data-label="Subject">{e.subject}</td>
                        <td data-label="Status">
                          <span className={`badge ${s.tone}`}>{s.text}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
          {deletionOn !== null ? (
            <p className="notice notice--warning" role="status">
              Your account is scheduled for deletion on{' '}
              {new Date(deletionOn).toLocaleDateString('en-US', { dateStyle: 'long' })}. Until then nothing is
              removed; cancel below if you have changed your mind.
            </p>
          ) : null}
          <DeleteAction scheduled={deletionOn !== null} />
        </div>
      </section>
    </div>
  );
}
