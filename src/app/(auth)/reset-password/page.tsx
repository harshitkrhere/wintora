import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage(): Promise<React.ReactElement> {
  // The recovery link has already been exchanged for a session by the
  // callback. No session means the link was bad or expired.
  try {
    await requireUser();
  } catch {
    redirect('/signin?error=expired');
  }

  return (
    <>
      <h1>Choose a new password</h1>
      <p className="lede">At least 12 characters. A sentence you will remember works well.</p>
      <ResetPasswordForm />
    </>
  );
}
