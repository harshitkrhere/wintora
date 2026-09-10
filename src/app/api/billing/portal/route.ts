/**
 * POST /api/billing/portal
 *
 * Opens the provider's hosted billing portal: payment method updates, invoices
 * and cancellation. Cancellation is one click and is not hidden behind a
 * support conversation.
 *
 * Under a Merchant of Record this portal belongs to the seller of record, so
 * the response says whose it is.
 */

import { type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handler, ok, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { getPaymentProvider } from '@/lib/payments';
import { BILLING_PAGE_DISCLOSURES, SELLER_OF_RECORD } from '@/config/disclosures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler('/api/billing/portal', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const provider = getPaymentProvider();
  const admin = createAdminClient();

  const { data } = await admin
    .from('billing_customers')
    .select('provider_customer_id')
    .eq('user_id', user.id)
    .eq('provider', provider.name)
    .maybeSingle();

  const customerId = (data as { provider_customer_id: string } | null)
    ?.provider_customer_id;

  if (customerId === undefined) {
    throw new AppError(
      'NOT_FOUND',
      'You do not have a billing account yet. Choose a plan to get started.',
    );
  }

  if (!provider.capabilities.hostedPortal) {
    throw new AppError(
      'BILLING_ERROR',
      'Billing management is not available yet. Please contact support.',
      { detail: `${provider.name} has no hosted portal.` },
    );
  }

  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  const session = await provider.createPortalSession(
    customerId,
    `${appUrl}/settings/subscription`,
  );

  return ok(context, {
    url: session.url,
    operatedBy: SELLER_OF_RECORD.legalName,
    note: BILLING_PAGE_DISCLOSURES.whoCharged,
  });
});
