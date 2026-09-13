/**
 * /cases/{id}/letters/new — write a letter for this case.
 *
 * The library is loaded from the database and the case fills in the fields
 * it already knows. What the customer's plan can do is passed down for
 * display; the API re-checks all of it.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCase } from '@/lib/cases/load';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { latestFindings, listPublishedTemplates } from '@/lib/letters/service';
import { LetterComposer, type TemplateSummary } from '@/components/LetterComposer';
import { DISCLAIMERS } from '@/config/disclaimers';

export const metadata: Metadata = { title: 'Write a letter', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function fromCents(cents: number | null, currency: string | null): string {
  if (cents === null) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD' }).format(cents / 100);
}

export default async function NewLetterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ template?: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const { template } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/cases/${id}/letters/new`)}`);
  }

  const admin = createAdminClient();
  const [detail, templates, summary, findings] = await Promise.all([
    loadCase(admin, user.id, id),
    listPublishedTemplates(admin),
    buildSubscriptionSummary(admin, user.id),
    latestFindings(admin, user.id, id),
  ]);
  if (detail === null) notFound();

  const { summary: c } = detail;
  const prefill: Record<string, string> = {};
  if (c.providerName) prefill.provider_name = c.providerName;
  if (c.accountReference) prefill.account_reference = c.accountReference;
  if (c.statementDate) prefill.statement_date = c.statementDate;
  const amount = fromCents(c.amountCents, c.currency);
  if (amount) prefill.balance = amount;

  const can = {
    letters: summary.features.LETTER_GENERATION === true,
    premiumTemplates: summary.features.PREMIUM_TEMPLATES === true,
    evidence: summary.features.ADVANCED_LETTERS === true,
  };

  const lettersLine = summary.usage.find((u) => u.featureKey === 'MONTHLY_LETTERS');

  return (
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
          <p className="eyebrow">
            <Link href="/cases">Cases</Link> · <Link href={`/cases/${c.id}`}>{c.title}</Link> · Letter
          </p>
          <h1>Write a letter</h1>
          <p className="lede">
            A draft from a reviewed template and the facts you give it. You read it, change
            anything you like, and send it yourself.
          </p>
        </div>
      </div>

      {!can.letters ? (
        <p className="notice notice--warning">
          Letters are not included in your current plan. <Link href="/pricing">See plans</Link>
        </p>
      ) : lettersLine !== undefined && lettersLine.limit !== null && (lettersLine.remaining ?? 0) === 0 ? (
        <p className="notice notice--warning">
          You have used all {lettersLine.limit} letter drafts for this period. Existing drafts stay
          editable. <Link href="/settings/subscription">Your plan</Link>
        </p>
      ) : lettersLine !== undefined && lettersLine.limit !== null ? (
        <p className="caption m-0">
          {lettersLine.remaining} of {lettersLine.limit} letter drafts left this period.
        </p>
      ) : null}

      <LetterComposer
        caseId={c.id}
        templates={templates.map(
          (t): TemplateSummary => ({
            key: t.key,
            name: t.name,
            description: t.description,
            category: t.category,
            fields: t.fields,
            isPremium: t.isPremium,
          }),
        )}
        prefill={prefill}
        can={{ premiumTemplates: can.premiumTemplates, evidence: can.evidence }}
        documents={detail.documents
          .filter((d) => d.scanStatus === 'CLEAN')
          .map((d) => ({ id: d.id, label: d.filename ?? 'Document' }))}
        findings={findings.map((f) => ({ id: f.id, label: f.title }))}
        initialTemplate={template}
      />

      <p className="notice">{DISCLAIMERS.LETTER_DRAFT}</p>
    </div>
  );
}
