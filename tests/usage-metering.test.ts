/**
 * Usage metering.
 *
 * The two properties that matter: a failed operation must not burn a credit,
 * and a retry must not burn two. Plus the concurrency case, which is the one
 * that quietly gives away revenue if the row lock is missing.
 */

import { describe, expect, it } from 'vitest';
import {
  QuotaExceededError,
  buildIdempotencyKey,
  createInMemoryUsageStore,
  withQuota,
} from '@/domain/usage/meter';
import { quotaWindow, rollingWindow, daysRemaining, windowKey } from '@/domain/usage/period';
import { snapshot, USER_A } from './helpers/store';

const DAY = 24 * 60 * 60 * 1000;

const WINDOW = {
  start: new Date('2026-09-01T00:00:00Z'),
  end: new Date('2026-10-01T00:00:00Z'),
};

function input(overrides: Partial<Parameters<ReturnType<typeof createInMemoryUsageStore>['consume']>[0]> = {}) {
  return {
    userId: USER_A,
    featureKey: 'MONTHLY_ANALYSES' as const,
    amount: 1,
    idempotencyKey: 'op-1',
    window: WINDOW,
    limit: 2,
    ...overrides,
  };
}

describe('consume', () => {
  it('allows up to the limit and then refuses', async () => {
    const store = createInMemoryUsageStore();

    const first = await store.consume(input({ idempotencyKey: 'a' }));
    expect(first.status).toBe('ALLOWED');
    expect(first.remaining).toBe(1);

    const second = await store.consume(input({ idempotencyKey: 'b' }));
    expect(second.status).toBe('ALLOWED');
    expect(second.remaining).toBe(0);

    const third = await store.consume(input({ idempotencyKey: 'c' }));
    expect(third.status).toBe('LIMIT_REACHED');
    expect(third.reservationId).toBeNull();
    expect(third.used).toBe(2);
  });

  it('treats a null limit as unlimited', async () => {
    const store = createInMemoryUsageStore();
    for (let i = 0; i < 50; i += 1) {
      const result = await store.consume(input({ limit: null, idempotencyKey: `k${i}` }));
      expect(result.status).toBe('ALLOWED');
      expect(result.remaining).toBeNull();
    }
  });

  it('rejects a non-positive amount rather than silently doing nothing', async () => {
    const store = createInMemoryUsageStore();
    await expect(store.consume(input({ amount: 0 }))).rejects.toThrow(RangeError);
    await expect(store.consume(input({ amount: -5 }))).rejects.toThrow(RangeError);
  });
});

describe('idempotency', () => {
  it('returns the original answer on a retry and consumes nothing extra', async () => {
    const store = createInMemoryUsageStore();

    const first = await store.consume(input({ idempotencyKey: 'same' }));
    const retry = await store.consume(input({ idempotencyKey: 'same' }));
    const retryAgain = await store.consume(input({ idempotencyKey: 'same' }));

    expect(first.status).toBe('ALLOWED');
    expect(retry.status).toBe('REPLAYED');
    expect(retryAgain.status).toBe('REPLAYED');
    expect(retry.used).toBe(1);
    expect(retryAgain.used).toBe(1);
    expect(retry.reservationId).toBe(first.reservationId);
  });

  it('builds a stable key from user, feature, window and operation', () => {
    const a = buildIdempotencyKey({
      userId: USER_A,
      featureKey: 'MONTHLY_LETTERS',
      window: WINDOW,
      operationKey: 'draft-7',
    });
    const b = buildIdempotencyKey({
      userId: USER_A,
      featureKey: 'MONTHLY_LETTERS',
      window: WINDOW,
      operationKey: 'draft-7',
    });
    expect(a).toBe(b);

    const differentWindow = buildIdempotencyKey({
      userId: USER_A,
      featureKey: 'MONTHLY_LETTERS',
      window: { start: new Date('2026-10-01'), end: new Date('2026-11-01') },
      operationKey: 'draft-7',
    });
    // A new billing period is a new allowance, so the key must differ.
    expect(differentWindow).not.toBe(a);
  });
});

describe('concurrency', () => {
  it('grants exactly the limit when many requests race', async () => {
    // This is the case that silently gives away revenue if the SELECT ... FOR
    // UPDATE is missing in SQL.
    const store = createInMemoryUsageStore();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, i) =>
        store.consume(input({ idempotencyKey: `race-${i}` })),
      ),
    );

    const allowed = results.filter((r) => r.status === 'ALLOWED');
    const denied = results.filter((r) => r.status === 'LIMIT_REACHED');

    expect(allowed).toHaveLength(2);
    expect(denied).toHaveLength(8);
    expect(store.counters.size).toBe(1);
  });
});

describe('withQuota', () => {
  it('commits when the operation succeeds', async () => {
    const store = createInMemoryUsageStore();
    const run = await withQuota(store, input({ idempotencyKey: 'ok' }), async () => 'done');

    expect(run.value).toBe('done');
    expect(run.remaining).toBe(1);
    expect(run.replayed).toBe(false);
  });

  it('returns the credit when an infrastructure failure is not the user fault', async () => {
    const store = createInMemoryUsageStore();

    await expect(
      withQuota(store, input({ idempotencyKey: 'boom' }), async () => {
        throw new Error('OCR provider timed out');
      }),
    ).rejects.toThrow('OCR provider timed out');

    // The counter is back where it started, so the user was not charged for
    // work that did not happen.
    const after = await store.consume(input({ idempotencyKey: 'next' }));
    expect(after.status).toBe('ALLOWED');
    expect(after.used).toBe(1);
  });

  it('returns the credit when input is rejected before any processing', async () => {
    const store = createInMemoryUsageStore();

    await expect(
      withQuota(
        store,
        input({ idempotencyKey: 'invalid' }),
        async () => {
          throw new Error('validation');
        },
        { classifyFailure: () => 'INVALID_INPUT_REJECTED_BEFORE_PROCESSING' },
      ),
    ).rejects.toThrow();

    const after = await store.consume(input({ idempotencyKey: 'after' }));
    expect(after.used).toBe(1);
  });

  it('retains the credit when the work was actually done', async () => {
    const store = createInMemoryUsageStore();

    await expect(
      withQuota(
        store,
        input({ idempotencyKey: 'disliked' }),
        async () => {
          throw new Error('client vanished after processing');
        },
        { classifyFailure: () => 'CLIENT_DISCONNECTED_AFTER_PROCESSING' },
      ),
    ).rejects.toThrow();

    // Still consumed: the analysis ran and the result was saved.
    const after = await store.consume(input({ idempotencyKey: 'after' }));
    expect(after.used).toBe(2);
  });

  it('throws QuotaExceededError rather than running the operation', async () => {
    const store = createInMemoryUsageStore();
    await store.consume(input({ idempotencyKey: 'x1' }));
    await store.consume(input({ idempotencyKey: 'x2' }));

    let ran = false;
    await expect(
      withQuota(store, input({ idempotencyKey: 'x3' }), async () => {
        ran = true;
        return 'nope';
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);

    expect(ran).toBe(false);
  });

  it('never double-refunds a rolled-back reservation', async () => {
    const store = createInMemoryUsageStore();
    const reservation = await store.consume(input({ idempotencyKey: 'refund' }));

    expect(await store.rollback(reservation.reservationId!)).toBe(true);
    expect(await store.rollback(reservation.reservationId!)).toBe(true);

    const after = await store.consume(input({ idempotencyKey: 'after' }));
    expect(after.used).toBe(1);
  });

  it('commit is idempotent', async () => {
    const store = createInMemoryUsageStore();
    const reservation = await store.consume(input({ idempotencyKey: 'commit' }));

    expect(await store.commit(reservation.reservationId!)).toBe(true);
    expect(await store.commit(reservation.reservationId!)).toBe(true);
  });
});

describe('mid-period limit changes', () => {
  it('adopts a larger limit immediately when a user upgrades', async () => {
    const store = createInMemoryUsageStore();
    await store.consume(input({ idempotencyKey: 'a', limit: 2 }));
    await store.consume(input({ idempotencyKey: 'b', limit: 2 }));

    // Upgrade: allowance grows, and the two already consumed are preserved.
    const afterUpgrade = await store.consume(input({ idempotencyKey: 'c', limit: 50 }));
    expect(afterUpgrade.status).toBe('ALLOWED');
    expect(afterUpgrade.used).toBe(3);
    expect(afterUpgrade.remaining).toBe(47);
  });

  it('ignores a smaller limit for the window already in progress', async () => {
    // A user legitimately under a limit at the time must not be retroactively
    // pushed over it. The new, smaller allowance applies from the next window.
    const store = createInMemoryUsageStore();
    for (let i = 0; i < 5; i += 1) {
      await store.consume(input({ idempotencyKey: `p${i}`, limit: 50 }));
    }

    const afterDowngrade = await store.consume(input({ idempotencyKey: 'q', limit: 2 }));
    expect(afterDowngrade.status).toBe('ALLOWED');
    expect(afterDowngrade.used).toBe(6);
  });
});

describe('quota windows', () => {
  it('uses the billing period verbatim while inside it', () => {
    const start = new Date('2026-09-14T00:00:00Z');
    const end = new Date('2026-10-14T00:00:00Z');
    const window = quotaWindow(
      snapshot({ currentPeriodStart: start, currentPeriodEnd: end }),
      new Date('2026-09-20T00:00:00Z'),
    );

    // The 14th to the 14th resets on the 14th, not on the 1st.
    expect(window.start.toISOString()).toBe(start.toISOString());
    expect(window.end.toISOString()).toBe(end.toISOString());
  });

  it('projects forward when the period has rolled but the webhook has not landed', () => {
    const start = new Date('2026-01-31T00:00:00Z');
    const end = new Date('2026-03-02T00:00:00Z'); // 30 days
    const window = quotaWindow(
      snapshot({ currentPeriodStart: start, currentPeriodEnd: end }),
      new Date('2026-03-10T00:00:00Z'),
    );

    // A delayed webhook must never cost the customer an allowance.
    expect(window.start.getTime()).toBe(end.getTime());
    expect(window.end.getTime()).toBe(end.getTime() + 30 * DAY);
  });

  it('falls back to a rolling window with no provider period', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const window = quotaWindow(
      snapshot({
        currentPeriodStart: null,
        currentPeriodEnd: null,
        accountCreatedAt: created,
      }),
      new Date('2026-02-05T00:00:00Z'),
    );

    expect(window.start.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });

  it('handles month-end and leap-day boundaries without drifting', () => {
    // 31 January must not silently become 3 March.
    const jan31 = new Date('2024-01-31T00:00:00Z');
    const window = rollingWindow(jan31, new Date('2024-02-15T00:00:00Z'), 30);
    expect(window.start.toISOString()).toBe(jan31.toISOString());
    expect(window.end.toISOString()).toBe('2024-03-01T00:00:00.000Z');

    // 2024 is a leap year: the 30-day arithmetic includes 29 February.
    const leap = rollingWindow(new Date('2024-02-01T00:00:00Z'), new Date('2024-02-20T00:00:00Z'), 30);
    expect(leap.end.toISOString()).toBe('2024-03-02T00:00:00.000Z');
  });

  it('does not move a boundary across a DST transition', () => {
    // All arithmetic is UTC, so a local clock change is irrelevant.
    const anchor = new Date('2026-03-01T00:00:00Z');
    const window = rollingWindow(anchor, new Date('2026-03-20T12:00:00Z'), 30);
    expect(window.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('reports days remaining for the reset copy', () => {
    const window = { start: new Date('2026-09-01'), end: new Date('2026-09-30') };
    expect(daysRemaining(window, new Date('2026-09-23'))).toBe(7);
    expect(daysRemaining(window, new Date('2026-10-05'))).toBe(0);
  });

  it('produces a stable window key', () => {
    expect(windowKey(WINDOW)).toBe(
      '2026-09-01T00:00:00.000Z_2026-10-01T00:00:00.000Z',
    );
  });
});
