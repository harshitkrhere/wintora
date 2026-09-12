/**
 * What an AppError sends to a client.
 *
 * Two clients act on a machine-readable reason: the anonymous checker shows
 * its sign-up wall for ANONYMOUS_LIMIT, and the privacy page asks for a fresh
 * sign-in for REQUIRES_VERIFICATION. Both once looked for `error.meta.reason`,
 * which was never serialised, so neither ever appeared. `reason` is public
 * and deliberate; `meta` and `detail` stay on the server.
 */

import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';

describe('AppError.toResponseBody', () => {
  it('sends a public reason when one is set', () => {
    const error = new AppError('ENTITLEMENT_DENIED', 'You have used the 5 free checks.', {
      reason: 'ANONYMOUS_LIMIT',
      detail: 'anonymous tool limit',
      meta: { limit: 5, used: 5 },
    });
    expect(error.toResponseBody('req-1')).toEqual({
      error: {
        code: 'ENTITLEMENT_DENIED',
        message: 'You have used the 5 free checks.',
        requestId: 'req-1',
        reason: 'ANONYMOUS_LIMIT',
      },
    });
  });

  it('omits the key entirely when there is no reason', () => {
    const body = new AppError('NOT_FOUND', 'We could not find that item.').toResponseBody('req-2');
    expect('reason' in body.error).toBe(false);
  });

  it('never serialises detail or meta', () => {
    const body = new AppError('INTERNAL', 'Something went wrong.', {
      detail: 'stack trace here',
      meta: { userId: 'u1' },
    }).toResponseBody('req-3');
    const text = JSON.stringify(body);
    expect(text).not.toContain('stack trace');
    expect(text).not.toContain('u1');
    expect(text).not.toContain('meta');
  });
});
