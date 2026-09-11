/**
 * Document storage, on the private bucket.
 *
 * The upload itself does NOT pass through this application. Vercel caps a
 * request body at 4.5 MB and the plans promise 10–25 MB, so the browser puts
 * the file straight into Supabase Storage using a signed, single-use URL that
 * is bound to one object path. The server then reads the object back to
 * inspect it. This is the standard shape for large uploads on serverless
 * hosts, and it means the bytes exist in exactly one place.
 *
 * Paths are {user_id}/{case_id}/{document_id}: ownership is in the path, the
 * bucket is private, and every read is server-side with an ownership check
 * already done. There is no public URL, ever.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

export function documentPath(userId: string, caseId: string, documentId: string): string {
  return `${userId}/${caseId}/${documentId}`;
}

function bucket(): string {
  return serverEnv().SUPABASE_DOCUMENTS_BUCKET;
}

/** A one-shot upload target for exactly this path. Expires in two hours. */
export async function createUploadTarget(
  admin: SupabaseClient,
  path: string,
): Promise<{ url: string; token: string }> {
  const { data, error } = await admin.storage.from(bucket()).createSignedUploadUrl(path);
  if (error !== null || data === null) {
    throw new Error(`storage: could not create upload url (${error?.message ?? 'no data'})`);
  }
  return { url: data.signedUrl, token: data.token };
}

export async function readObject(admin: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(bucket()).download(path);
  if (error !== null || data === null) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function deleteObject(admin: SupabaseClient, path: string): Promise<void> {
  // Best effort. A dangling object is swept by retention; a thrown error here
  // would mask the real reason the upload was rejected.
  await admin.storage.from(bucket()).remove([path]);
}
