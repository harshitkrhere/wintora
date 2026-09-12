import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false, follow: false } };

export default function ForgotPasswordPage(): React.ReactElement {
  return (
    <>
      <h1>Reset your password</h1>
      <p className="lede">Enter your email and we will send a link to choose a new one.</p>
      <ForgotPasswordForm />
      <div className="auth-links">
        <p>
          <Link href="/signin">Back to sign in</Link>
        </p>
      </div>
    </>
  );
}
