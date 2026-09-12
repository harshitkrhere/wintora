/**
 * Annual billing: what changes, and what must not.
 *
 * The one thing that must not change is what "per month" means. A customer
 * paying yearly for Plus gets 50 analyses a month, not 50 a year; the quota
 * window is cut from the billing period rather than being the billing period.
 */

import { describe, expect, it } from 'vitest';
import {
  annualSavingPercent,
  compareOffers,
  formatPrice,
  perMonthEquivalentCents,
  priceFor,
} from '@/config/plans';
import type { SubscriptionSnapshot } from '@/domain/entitlements/types';
import {
  daysRemaining,
  monthlyWindowWithin,
  monthsInPeriod,
  quotaWindow,
  windowKey,
} from '@/domain/usage/period';

const DAY_MS = 24 * 60 * 60 * 1000;

function snapshot(start: string, end: string): SubscriptionSnapshot {
  return {
    status: 'ACTIVE',
    planSlug: 'plus',
    currentPeriodStart: new Date(start),
    currentPeriodEnd: new Date(end),
    gracePeriodEnd: null,
    pendingPlanSlug: null,
    pendingPlanEffectiveAt: null,
    pauseEnd: null,
    accountCreatedAt: new Date('2025-01-01T00:00:00Z'),
  };
}

describe('monthsInPeriod', () => {
  it('counts a month as one window whatever its length', () => {
    for (const [s, e] of [
      ['2026-02-01', '2026-03-01'], // 28 days
      ['2026-01-14', '2026-02-14'], // 31 days
      ['2028-02-01', '2028-03-01'], // 29 days, leap year
      ['2026-04-01', '2026-05-01'], // 30 days
    ]) {
      expect(monthsInPeriod({ start: new Date(s!), end: new Date(e!) }), `${s} → ${e}`).toBe(1);
    }
  });

  it('counts a year as twelve, in leap years too', () => {
    expect(monthsInPeriod({ start: new Date('2026-03-10'), end: new Date('2027-03-10') })).toBe(12);
    expect(monthsInPeriod({ start: new Date('2028-01-01'), end: new Date('2029-01-01') })).toBe(12);
  });
});

describe('monthlyWindowWithin', () => {
  const period = { start: new Date('2026-03-10T00:00:00Z'), end: new Date('2027-03-10T00:00:00Z') };

  it('returns a monthly period unchanged', () => {
    const month = { start: new Date('2026-03-10T00:00:00Z'), end: new Date('2026-04-10T00:00:00Z') };
    expect(monthlyWindowWithin(month, new Date('2026-03-25T00:00:00Z'))).toEqual(month);
  });

  it('cuts a year into twelve windows that tile the period exactly', () => {
    const windows: { start: Date; end: Date }[] = [];
    let probe = period.start.getTime();
    while (probe < period.end.getTime()) {
      const w = monthlyWindowWithin(period, new Date(probe));
      if (windows.length === 0 || windows[windows.length - 1]!.start.getTime() !== w.start.getTime()) {
        windows.push(w);
      }
      probe = w.end.getTime();
    }

    expect(windows).toHaveLength(12);
    expect(windows[0]!.start.getTime()).toBe(period.start.getTime());
    expect(windows[11]!.end.getTime()).toBe(period.end.getTime());
    for (let i = 1; i < windows.length; i += 1) {
      // Contiguous: each window starts exactly where the previous one ended.
      expect(windows[i]!.start.getTime()).toBe(windows[i - 1]!.end.getTime());
    }
    for (const w of windows) {
      const days = (w.end.getTime() - w.start.getTime()) / DAY_MS;
      expect(days).toBeGreaterThan(30);
      expect(days).toBeLessThan(31);
    }
  });

  it('places the same instant in the same window every time', () => {
    const now = new Date('2026-09-12T11:00:00Z');
    const a = monthlyWindowWithin(period, now);
    const b = monthlyWindowWithin(period, now);
    expect(windowKey(a)).toBe(windowKey(b));
    expect(now.getTime()).toBeGreaterThanOrEqual(a.start.getTime());
    expect(now.getTime()).toBeLessThan(a.end.getTime());
  });

  it('clamps the final instant of the period into the last window', () => {
    const lastMoment = new Date(period.end.getTime() - 1);
    const w = monthlyWindowWithin(period, lastMoment);
    expect(w.end.getTime()).toBe(period.end.getTime());
  });
});

describe('quotaWindow on an annual subscription', () => {
  const annual = snapshot('2026-03-10T00:00:00Z', '2027-03-10T00:00:00Z');

  it('is a month wide, not a year wide', () => {
    const w = quotaWindow(annual, new Date('2026-03-20T00:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-03-10T00:00:00.000Z');
    expect((w.end.getTime() - w.start.getTime()) / DAY_MS).toBeLessThan(31);
    expect(daysRemaining(w, new Date('2026-03-20T00:00:00Z'))).toBeLessThanOrEqual(21);
  });

  it('resets during the year: the fifth month is a different window from the first', () => {
    const first = quotaWindow(annual, new Date('2026-03-20T00:00:00Z'));
    const fifth = quotaWindow(annual, new Date('2026-07-20T00:00:00Z'));
    expect(windowKey(first)).not.toBe(windowKey(fifth));
  });

  it('still projects forward when the renewal webhook is late, and cuts the projection too', () => {
    // Fifteen days into the next year, no webhook yet.
    const w = quotaWindow(annual, new Date('2027-03-25T00:00:00Z'));
    expect(w.start.toISOString()).toBe('2027-03-10T00:00:00.000Z');
    expect((w.end.getTime() - w.start.getTime()) / DAY_MS).toBeLessThan(31);
  });

  it('ignores the period left behind by an ended subscription', () => {
    // An EXPIRED row keeps its last period as history. The account is on the
    // free plan, so it gets the free plan's rolling window, not a "resets on"
    // date taken from a subscription that no longer exists.
    const ended: SubscriptionSnapshot = { ...annual, status: 'EXPIRED' };
    const w = quotaWindow(ended, new Date('2026-09-12T00:00:00Z'));
    expect(w.start.getTime()).not.toBe(new Date('2026-03-10T00:00:00Z').getTime());
    expect((w.end.getTime() - w.start.getTime()) / DAY_MS).toBe(30);
    // Anchored to account creation, like any free account.
    expect((w.start.getTime() - ended.accountCreatedAt.getTime()) % (30 * DAY_MS)).toBe(0);
  });

  it('leaves monthly subscriptions exactly as before', () => {
    const monthly = snapshot('2026-03-10T00:00:00Z', '2026-04-10T00:00:00Z');
    const w = quotaWindow(monthly, new Date('2026-03-20T00:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-03-10T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-04-10T00:00:00.000Z');
  });
});

describe('offers', () => {
  it('treats a longer interval on the same plan as an upgrade, and shorter as a downgrade', () => {
    expect(compareOffers({ slug: 'plus', interval: 'month' }, { slug: 'plus', interval: 'year' })).toBe(1);
    expect(compareOffers({ slug: 'plus', interval: 'year' }, { slug: 'plus', interval: 'month' })).toBe(-1);
    expect(compareOffers({ slug: 'plus', interval: 'year' }, { slug: 'plus', interval: 'year' })).toBe(0);
  });

  it('lets the plan tier decide before the interval does', () => {
    // Pro monthly is still above Plus yearly: tier first, interval second.
    expect(compareOffers({ slug: 'plus', interval: 'year' }, { slug: 'pro', interval: 'month' })).toBe(1);
    expect(compareOffers({ slug: 'pro', interval: 'month' }, { slug: 'essential', interval: 'year' })).toBe(-1);
  });

  it('computes the annual saving from the catalog, never from copy', () => {
    const month = priceFor('plus', 'US', 'month')!;
    const year = priceFor('plus', 'US', 'year')!;
    const expected = Math.round(((month.amountCents * 12 - year.amountCents) / (month.amountCents * 12)) * 100);
    expect(annualSavingPercent('plus', 'US')).toBe(expected);
    expect(perMonthEquivalentCents(year)).toBe(Math.round(year.amountCents / 12));
    expect(perMonthEquivalentCents(month)).toBe(month.amountCents);
  });
});

describe('formatPrice', () => {
  it('names the currency when it is not US dollars, so the CAD card cannot pass for USD', () => {
    expect(formatPrice(1999, 'USD')).toBe('$19.99');
    expect(formatPrice(2599, 'CAD')).toBe('CA$25.99');
  });
});
