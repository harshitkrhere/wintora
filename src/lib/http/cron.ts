/**
 * Scheduled job authentication.
 *
 * Cron endpoints run privileged work (deleting documents, reconciling billing),
 * so they authenticate with a shared secret compared in constant time and are
 * never reachable with a user session.
 */

import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { forbidden } from '@/lib/errors';

export function assertCronAuthorized(request: NextRequest): void {
  const configured = serverEnv().CRON_SECRET;
  if (configured === undefined || configured.length === 0) {
    // Fail closed. An unconfigured secret must not mean an open endpoint.
    throw forbidden('CRON_SECRET is not configured.');
  }

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

  const a = Buffer.from(presented);
  const b = Buffer.from(configured);

  // Length is compared first because timingSafeEqual throws on a mismatch;
  // the early return leaks only the length, which is not the secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw forbidden('Invalid cron credentials.');
  }
}
