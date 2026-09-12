/**
 * /settings/billing
 *
 * Payment method, invoices and cancellation all live on the subscription page,
 * because the provider has no separate customer portal to send anyone to. This
 * route exists so an old link or a bookmark still lands somewhere useful.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function BillingRedirectPage(): never {
  redirect('/settings/subscription');
}
