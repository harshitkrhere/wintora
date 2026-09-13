/**
 * /settings
 *
 * There is no settings index to show: the two settings pages carry their
 * own navigation. A typed or bookmarked /settings lands on the first one.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function SettingsIndexPage(): never {
  redirect('/settings/subscription');
}
