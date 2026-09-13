/**
 * Funnel events: the "first only" rule, the helper that never throws, and
 * the anonymous hash that keeps no address.
 */

import { describe, expect, it } from 'vitest';
import { anonymousHash, isFirst, recordIfFirst, recordOnce, recordProductEvent, type EventsClient } from '@/lib/events/record';

function fakeClient(behaviour: 'ok' | 'error' | 'throw'): EventsClient & { inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    from() {
      return {
        insert(row: Record<string, unknown>) {
          if (behaviour === 'throw') throw new Error('network down');
          if (behaviour === 'error') return Promise.resolve({ error: { code: '42P01', message: 'relation missing' } });
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
        select() {
          // A count of what is already inserted for that kind and account.
          return {
            eq(_c: string, kind: unknown) {
              return {
                eq(_c2: string, userId: unknown) {
                  if (behaviour === 'throw') throw new Error('network down');
                  const count = inserted.filter((r) => r.kind === kind && r.user_id === userId).length;
                  return Promise.resolve({ count, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

describe('recordProductEvent', () => {
  it('writes the event with nulls for what is not given', async () => {
    const client = fakeClient('ok');
    await recordProductEvent(client, { kind: 'signup_completed', userId: 'u1' });
    expect(client.inserted).toEqual([{ kind: 'signup_completed', user_id: 'u1', anon_hash: null, case_id: null }]);
  });

  it('never throws: a database error is logged and swallowed', async () => {
    await expect(recordProductEvent(fakeClient('error'), { kind: 'free_limit_hit', userId: 'u1' })).resolves.toBeUndefined();
  });

  it('never throws: a thrown error is logged and swallowed', async () => {
    await expect(recordProductEvent(fakeClient('throw'), { kind: 'free_limit_hit', userId: 'u1' })).resolves.toBeUndefined();
  });
});

describe('first only', () => {
  it('is the first when the count including this one is exactly one', () => {
    expect(isFirst(1)).toBe(true);
    expect(isFirst(2)).toBe(false);
    expect(isFirst(0)).toBe(false);
    expect(isFirst(null)).toBe(false);
    expect(isFirst(undefined)).toBe(false);
  });

  it('records on the first and not on the second', async () => {
    const client = fakeClient('ok');
    expect(await recordIfFirst(client, { kind: 'first_document_uploaded', userId: 'u1' }, 1)).toBe(true);
    expect(await recordIfFirst(client, { kind: 'first_document_uploaded', userId: 'u1' }, 2)).toBe(false);
    expect(client.inserted).toHaveLength(1);
  });

  it('records nothing when the count is unknown', async () => {
    const client = fakeClient('ok');
    expect(await recordIfFirst(client, { kind: 'first_letter_sent', userId: 'u1' }, null)).toBe(false);
    expect(client.inserted).toHaveLength(0);
  });
});

describe('recordOnce', () => {
  it('records the first time and never again for the same account, whatever path asks', async () => {
    const client = fakeClient('ok');
    expect(await recordOnce(client, { kind: 'signup_completed', userId: 'u1' })).toBe(true);
    expect(await recordOnce(client, { kind: 'signup_completed', userId: 'u1' })).toBe(false);
    expect(await recordOnce(client, { kind: 'signup_completed', userId: 'u2' })).toBe(true);
    expect(client.inserted.filter((r) => r.user_id === 'u1')).toHaveLength(1);
  });

  it('does nothing, and does not throw, when the lookup fails', async () => {
    expect(await recordOnce(fakeClient('throw'), { kind: 'signup_completed', userId: 'u1' })).toBe(false);
  });
});

describe('anonymousHash', () => {
  it('is stable for one address and secret, and different across secrets', () => {
    const a = anonymousHash('203.0.113.7', 'secret-one');
    expect(a).toBe(anonymousHash('203.0.113.7', 'secret-one'));
    expect(a).not.toBe(anonymousHash('203.0.113.7', 'secret-two'));
    expect(a).not.toBe(anonymousHash('203.0.113.8', 'secret-one'));
  });

  it('does not contain the address and is undefined without one', () => {
    const h = anonymousHash('203.0.113.7', 'secret-one')!;
    expect(h).not.toContain('203');
    expect(h).toMatch(/^[a-f0-9]{32}$/);
    expect(anonymousHash(undefined, 'secret-one')).toBeUndefined();
    expect(anonymousHash('', 'secret-one')).toBeUndefined();
  });
});
