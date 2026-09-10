/**
 * Frontend tampering and cross-user access.
 *
 * Everything here is expected behaviour from an attacker and must be denied by
 * the backend. The client cache is display only; nothing it claims is an input
 * to an authorization decision.
 *
 * See docs/ENTITLEMENTS.md section 6 and docs/THREAT_MODEL.md T2 and T6.
 */

import { describe, expect, it } from 'vitest';
import { checkEntitlement } from '@/domain/entitlements/check';
import { computeEntitlements } from '@/domain/entitlements/compute';
import { createInMemoryUsageStore } from '@/domain/usage/meter';
import { CASE_A, CASE_B, USER_A, createFakeStore, snapshot } from './helpers/store';

const WINDOW = {
  start: new Date('2026-09-01T00:00:00Z'),
  end: new Date('2026-10-01T00:00:00Z'),
};

describe('a client claiming a plan it did not buy', () => {
  it('ignores a forged plan name in the request and reads the database', async () => {
    // localStorage, a cookie, or a hand-edited API payload can all say "pro".
    // checkEntitlement takes a userId and reads the stored subscription; there
    // is no parameter through which a caller can assert a plan.
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'free', status: 'FREE' }),
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'HOUSEHOLD_CASES',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.plan).toBe('free');
  });

  it('denies premium access on an expired subscription', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'pro', status: 'EXPIRED' }),
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'ADVANCED_EXPORT',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.plan).toBe('free');
  });

  it('denies premium access on a refunded subscription', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'plus', status: 'REFUNDED' }),
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'DEADLINE_TRACKING',
    });

    expect(decision.allowed).toBe(false);
  });

  it('denies premium access on a revoked subscription', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'pro', status: 'REVOKED' }),
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'HOUSEHOLD_CASES',
    });

    expect(decision.allowed).toBe(false);
  });
});

describe('reaching the success page grants nothing', () => {
  it('leaves entitlements at free until billing state actually changes', () => {
    // Replaying /billing/success, or landing on it after abandoning payment,
    // must not move anything. Only a verified webhook does.
    const pending = computeEntitlements(
      snapshot({ status: 'CHECKOUT_PENDING', planSlug: 'pro' }),
    );

    expect(pending.HOUSEHOLD_CASES.enabled).toBe(false);
    expect(pending.MONTHLY_ANALYSES.limitValue).toBe(2);
  });
});

describe('cross-user resource access', () => {
  it('denies an operation on a resource the caller does not own', async () => {
    // The important case: entitlement and ownership are SEPARATE questions.
    // Being on Pro entitles you to run an analysis. It does not entitle you to
    // run one on someone else's case.
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'pro' }),
      ownedResourceIds: [CASE_A],
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'MONTHLY_ANALYSES',
      resource: { type: 'case', id: CASE_B },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('NOT_OWNER');
  });

  it('never confirms that the other user resource exists', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'pro' }),
      ownedResourceIds: [CASE_A],
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'MONTHLY_ANALYSES',
      resource: { type: 'case', id: CASE_B },
    });

    expect(decision.message).toBe('We could not find that item.');
    expect(decision.message).not.toMatch(/another user|belongs to|not yours|forbidden/i);
  });

  it('records the attempt as a security event', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'pro' }),
      ownedResourceIds: [CASE_A],
    });

    await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'MONTHLY_ANALYSES',
      resource: { type: 'case', id: CASE_B },
    });

    expect(store.securityEvents).toHaveLength(1);
    expect(store.securityEvents[0]!.type).toBe('CROSS_USER_ACCESS_ATTEMPT');
    expect(store.securityEvents[0]!.detail.resourceId).toBe(CASE_B);
  });

  it('allows the same operation on a resource the caller does own', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'pro' }),
      ownedResourceIds: [CASE_A],
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'MONTHLY_ANALYSES',
      resource: { type: 'case', id: CASE_A },
    });

    expect(decision.allowed).toBe(true);
    expect(store.securityEvents).toHaveLength(0);
  });

  it('checks ownership for every resource type', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'pro' }),
      ownedResourceIds: [],
    });

    for (const type of [
      'case',
      'document',
      'analysis',
      'generated_document',
      'export',
    ] as const) {
      const decision = await checkEntitlement({ store }, {
        userId: USER_A,
        feature: 'DOCUMENT_UPLOAD',
        resource: { type, id: CASE_B },
      });
      expect(decision.allowed, `resource type ${type}`).toBe(false);
    }
  });
});

describe('quota bypass attempts', () => {
  it('cannot be beaten by racing concurrent requests', async () => {
    const store = createInMemoryUsageStore();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_unused, i) =>
        store.consume({
          userId: USER_A,
          featureKey: 'MONTHLY_ANALYSES',
          amount: 1,
          idempotencyKey: `race-${i}`,
          window: WINDOW,
          limit: 2,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'ALLOWED')).toHaveLength(2);
  });

  it('cannot be beaten by reusing an idempotency key to get free work', async () => {
    // Replaying a key returns the ORIGINAL result. It does not grant a second
    // reservation, and it does not reset the counter either.
    const store = createInMemoryUsageStore();
    const args = {
      userId: USER_A,
      featureKey: 'MONTHLY_ANALYSES' as const,
      amount: 1,
      idempotencyKey: 'reused',
      window: WINDOW,
      limit: 2,
    };

    await store.consume(args);
    for (let i = 0; i < 50; i += 1) await store.consume(args);

    const fresh = await store.consume({ ...args, idempotencyKey: 'new' });
    expect(fresh.used).toBe(2);

    const third = await store.consume({ ...args, idempotencyKey: 'third' });
    expect(third.status).toBe('LIMIT_REACHED');
  });

  it('cannot be beaten by claiming a larger limit in the request', async () => {
    // A client-supplied limit is not trusted: the route passes the limit from
    // the entitlement decision, which comes from the database. Even so, the
    // meter refuses to shrink an in-progress window and only ever adopts a
    // larger one, so a hostile SMALLER value cannot strand a user either.
    const store = createInMemoryUsageStore();

    await store.consume({
      userId: USER_A,
      featureKey: 'MONTHLY_ANALYSES',
      amount: 1,
      idempotencyKey: 'a',
      window: WINDOW,
      limit: 2,
    });

    const shrunk = await store.consume({
      userId: USER_A,
      featureKey: 'MONTHLY_ANALYSES',
      amount: 1,
      idempotencyKey: 'b',
      window: WINDOW,
      limit: 1,
    });

    expect(shrunk.limit).toBe(2);
  });

  it('cannot be beaten by an oversized amount', async () => {
    const store = createInMemoryUsageStore();
    const result = await store.consume({
      userId: USER_A,
      featureKey: 'MONTHLY_ANALYSES',
      amount: 1_000_000,
      idempotencyKey: 'huge',
      window: WINDOW,
      limit: 2,
    });

    expect(result.status).toBe('LIMIT_REACHED');
    expect(result.used).toBe(0);
  });
});

describe('safe mode cannot be bypassed by the client', () => {
  it('blocks processing regardless of plan', async () => {
    const store = createFakeStore({ subscription: snapshot({ planSlug: 'pro' }) });

    const decision = await checkEntitlement({ store, safeMode: true }, {
      userId: USER_A,
      feature: 'LETTER_GENERATION',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.gateState).toBe('TEMPORARILY_UNAVAILABLE');
  });

  it('still lets a user get their data out', async () => {
    // An incident must not become a data-hostage situation.
    const store = createFakeStore({ subscription: snapshot({ planSlug: 'free' }) });

    const decision = await checkEntitlement(
      { store, safeMode: true, lastAuthenticatedAt: new Date() },
      { userId: USER_A, feature: 'DATA_EXPORT' },
    );

    expect(decision.allowed).toBe(true);
  });
});
