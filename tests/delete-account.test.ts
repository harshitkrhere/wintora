/**
 * Executing a due account deletion: the order of the steps, what is
 * written before anything is removed, and every way a job goes back to the
 * queue with its reason instead of half-deleting an account.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executeDueDeletions, type DeletionEffects } from '@/lib/privacy/delete-account';

interface Op {
  table: string;
  verb: 'select' | 'update' | 'upsert' | 'insert';
  payload: unknown;
  filters: Record<string, unknown>;
  single: boolean;
}

type Handler = (op: Op) => { data: unknown; error: { code: string } | null };

/** A chainable stand-in for the admin client: every call is recorded, the handler answers. */
function fakeAdmin(handlers: Record<string, Handler>): SupabaseClient & { ops: Op[] } {
  const ops: Op[] = [];
  const from = (table: string): unknown => {
    const op: Op = { table, verb: 'select', payload: null, filters: {}, single: false };
    const builder: Record<string, unknown> = {};
    const chain = (): unknown => builder;
    builder.select = () => chain();
    builder.update = (payload: unknown) => {
      op.verb = 'update';
      op.payload = payload;
      return chain();
    };
    builder.upsert = (payload: unknown) => {
      op.verb = 'upsert';
      op.payload = payload;
      return chain();
    };
    builder.insert = (payload: unknown) => {
      op.verb = 'insert';
      op.payload = payload;
      return chain();
    };
    for (const f of ['eq', 'is', 'lte', 'not', 'in', 'gte', 'neq']) {
      builder[f] = (k: string, v: unknown) => {
        op.filters[`${f}:${k}`] = v;
        return chain();
      };
    }
    builder.order = () => chain();
    builder.limit = () => chain();
    builder.maybeSingle = () => {
      op.single = true;
      return chain();
    };
    builder.single = () => {
      op.single = true;
      return chain();
    };
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      ops.push(op);
      const handler = handlers[table];
      try {
        const result = handler !== undefined ? handler(op) : { data: op.single ? null : [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    };
    return builder;
  };
  return { from, ops } as unknown as SupabaseClient & { ops: Op[] };
}

function effects(over: Partial<DeletionEffects> = {}): DeletionEffects & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    removeObjects: async (paths) => {
      calls.push(`remove:${paths.length}`);
    },
    cancelSubscription: async (id) => {
      calls.push(`cancel:${id}`);
    },
    deleteAuthUser: async (id) => {
      calls.push(`delete:${id}`);
    },
    notifyDeleted: async (id) => {
      calls.push(`notify:${id}`);
    },
    ...over,
  };
}

const NOW = new Date('2026-09-20T03:00:00Z');
const JOB = { id: 'job-1', user_id: 'user-1', created_at: '2026-09-12T10:00:00Z' };

function handlers(over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    deletion_jobs: (op) => {
      if (op.verb === 'select') return { data: [JOB], error: null };
      if (op.verb === 'update' && (op.payload as { status: string }).status === 'RUNNING') return { data: { id: JOB.id }, error: null };
      return { data: null, error: null };
    },
    subscriptions: (op) =>
      'in:status' in op.filters
        ? { data: { provider: 'razorpay', provider_customer_id: 'cust_1', provider_subscription_id: 'sub_1', status: 'ACTIVE' }, error: null }
        : { data: null, error: null },
    invoices: () => ({
      data: [
        {
          provider_invoice_id: 'inv_1', number: 'W-1', amount_due_cents: 1999, amount_paid_cents: 1999, tax_cents: 0,
          currency: 'USD', status: 'paid', period_start: null, period_end: null, issued_at: '2026-08-01T00:00:00Z', paid_at: '2026-08-01T00:00:00Z',
        },
      ],
      error: null,
    }),
    account_tombstones: () => ({ data: null, error: null }),
    documents: () => ({ data: [{ storage_path: 'u/a.pdf' }, { storage_path: 'u/b.pdf' }], error: null }),
    ...over,
  };
}

describe('executeDueDeletions', () => {
  it('runs the steps in order and deletes the user last', async () => {
    const admin = fakeAdmin(handlers());
    const fx = effects();
    const run = await executeDueDeletions(admin, NOW, fx);
    expect(run).toEqual({ executed: 1, deferred: 0 });
    expect(fx.calls).toEqual(['cancel:sub_1', 'remove:2', 'notify:user-1', 'delete:user-1']);

    const claim = admin.ops.find((o) => o.table === 'deletion_jobs' && o.verb === 'update');
    expect(claim?.payload).toEqual({ status: 'RUNNING', error_class: null });

    const tombstone = admin.ops.find((o) => o.table === 'account_tombstones');
    expect(tombstone?.verb).toBe('upsert');
    const written = tombstone?.payload as { user_id: string; provider: string; billing: unknown[]; requested_at: string };
    expect(written.user_id).toBe('user-1');
    expect(written.provider).toBe('razorpay');
    expect(written.requested_at).toBe(JOB.created_at);
    expect(written.billing).toHaveLength(1);
    expect(JSON.stringify(written)).not.toMatch(/@|\.pdf/);
  });

  it('writes the tombstone before removing anything', async () => {
    const admin = fakeAdmin(handlers());
    const order: string[] = [];
    const fx = effects({
      removeObjects: async () => {
        order.push('remove');
      },
      deleteAuthUser: async () => {
        order.push('delete');
      },
    });
    await executeDueDeletions(admin, NOW, fx);
    const tombstoneAt = admin.ops.findIndex((o) => o.table === 'account_tombstones');
    const documentsAt = admin.ops.findIndex((o) => o.table === 'documents');
    expect(tombstoneAt).toBeGreaterThan(-1);
    expect(tombstoneAt).toBeLessThan(documentsAt);
    expect(order).toEqual(['remove', 'delete']);
  });

  it('skips a job that was cancelled between the read and the claim', async () => {
    const admin = fakeAdmin(
      handlers({
        deletion_jobs: (op) => (op.verb === 'select' ? { data: [JOB], error: null } : { data: null, error: null }),
      }),
    );
    const fx = effects();
    const run = await executeDueDeletions(admin, NOW, fx);
    expect(run).toEqual({ executed: 0, deferred: 0 });
    expect(fx.calls).toEqual([]);
  });

  it('does not touch the provider when there is no live subscription', async () => {
    const admin = fakeAdmin(handlers({ subscriptions: () => ({ data: null, error: null }) }));
    const fx = effects();
    await executeDueDeletions(admin, NOW, fx);
    expect(fx.calls).toEqual(['remove:2', 'notify:user-1', 'delete:user-1']);
  });

  it('puts the job back with the reason when the provider refuses, and removes nothing', async () => {
    const admin = fakeAdmin(handlers());
    const fx = effects({
      cancelSubscription: async () => {
        throw new TypeError('provider down');
      },
    });
    const run = await executeDueDeletions(admin, NOW, fx);
    expect(run).toEqual({ executed: 0, deferred: 1 });
    expect(fx.calls).toEqual([]);
    const requeue = admin.ops.filter((o) => o.table === 'deletion_jobs' && o.verb === 'update').at(-1);
    expect(requeue?.payload).toEqual({ status: 'QUEUED', error_class: 'cancel:TypeError' });
    expect(admin.ops.some((o) => o.table === 'account_tombstones')).toBe(false);
  });

  it('puts the job back when the tombstone cannot be written', async () => {
    const admin = fakeAdmin(handlers({ account_tombstones: () => ({ data: null, error: { code: '42P01' } }) }));
    const fx = effects();
    const run = await executeDueDeletions(admin, NOW, fx);
    expect(run).toEqual({ executed: 0, deferred: 1 });
    expect(fx.calls).toEqual(['cancel:sub_1']);
    const requeue = admin.ops.filter((o) => o.table === 'deletion_jobs' && o.verb === 'update').at(-1);
    expect(requeue?.payload).toEqual({ status: 'QUEUED', error_class: 'tombstone:42P01' });
  });

  it('puts the job back when a storage object cannot be removed, before the user is deleted', async () => {
    const admin = fakeAdmin(handlers());
    const fx = effects({
      removeObjects: async () => {
        throw new Error('bucket');
      },
    });
    const run = await executeDueDeletions(admin, NOW, fx);
    expect(run).toEqual({ executed: 0, deferred: 1 });
    expect(fx.calls).toEqual(['cancel:sub_1']);
    expect(fx.calls).not.toContain('delete:user-1');
  });

  it('puts the job back when the auth user cannot be deleted', async () => {
    const admin = fakeAdmin(handlers());
    const fx = effects({
      deleteAuthUser: async () => {
        throw new Error('auth');
      },
    });
    const run = await executeDueDeletions(admin, NOW, fx);
    expect(run).toEqual({ executed: 0, deferred: 1 });
    const requeue = admin.ops.filter((o) => o.table === 'deletion_jobs' && o.verb === 'update').at(-1);
    expect(requeue?.payload).toEqual({ status: 'QUEUED', error_class: 'auth:Error' });
  });

  it('removes storage objects in batches of a hundred', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ storage_path: `u/${i}.pdf` }));
    const admin = fakeAdmin(handlers({ documents: () => ({ data: many, error: null }) }));
    const fx = effects();
    await executeDueDeletions(admin, NOW, fx);
    expect(fx.calls.filter((c) => c.startsWith('remove:'))).toEqual(['remove:100', 'remove:100', 'remove:50']);
  });

  it('asks only for due, uncancelled, account-scoped jobs', async () => {
    const admin = fakeAdmin(handlers({ deletion_jobs: () => ({ data: [], error: null }) }));
    await executeDueDeletions(admin, NOW, effects());
    const read = admin.ops.find((o) => o.table === 'deletion_jobs');
    expect(read?.filters).toMatchObject({
      'eq:status': 'QUEUED',
      'eq:scope': 'ACCOUNT',
      'is:canceled_at': null,
      'lte:execute_after': NOW.toISOString(),
    });
  });
});
