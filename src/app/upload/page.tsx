/**
 * /upload
 *
 * Upload a bill, have it read, check the figures, run the analysis. Signed-in
 * only; the public tools stay at /medical-bill-checker for anyone else.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { UploadFlow } from '@/components/UploadFlow';

export const metadata: Metadata = {
  title: 'Upload a bill',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}): Promise<React.ReactElement> {
  try {
    await requireUser();
  } catch {
    redirect('/signin?next=%2Fupload');
  }

  const params = await searchParams;
  const initialCaseId =
    typeof params.case === 'string' && /^[0-9a-f-]{36}$/i.test(params.case) ? params.case : null;

  return (
    <div className="shell stack--lg" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
      <div>
        <p className="eyebrow">Upload</p>
        <h1>Check a bill from your documents</h1>
        <p className="muted">
          Upload a PDF or a photo. We read the figures, you confirm them, and the same
          deterministic engine that runs the free tool checks the arithmetic.
        </p>
      </div>

      <UploadFlow initialCaseId={initialCaseId} />

      <p className="small muted">
        Prefer to type the numbers in? <Link href="/medical-bill-checker">Use the bill checker</Link>.
      </p>
    </div>
  );
}
