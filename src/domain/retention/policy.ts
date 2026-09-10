/**
 * Document retention.
 *
 * Retention is governed by the retention system, NOT by billing. A subscription
 * lapsing deletes nothing, and a document expiring affects no subscription.
 * When a plan change does shrink the retention window, a transition window
 * gives the user time to download or export first.
 *
 * Case records, findings and generated letters are text, are small, and are NOT
 * subject to plan-based document retention. Losing a plan does not erase a
 * person's record of what happened.
 *
 * Pure module: no I/O. See docs/PRIVACY.md section 3.
 */

import { POLICY } from '@/config/policy';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionInput {
  readonly uploadedAt: Date;
  readonly retentionDays: number;
}

export interface DocumentRetentionState {
  readonly documentId: string;
  readonly uploadedAt: Date;
  readonly retentionUntil: Date;
}

export function retentionUntil(input: RetentionInput): Date {
  if (input.retentionDays <= 0) {
    throw new RangeError(
      `retentionUntil: retentionDays must be positive, got ${input.retentionDays}`,
    );
  }
  return new Date(input.uploadedAt.getTime() + input.retentionDays * DAY_MS);
}

export function daysUntilExpiry(retentionUntilDate: Date, now: Date = new Date()): number {
  return Math.ceil((retentionUntilDate.getTime() - now.getTime()) / DAY_MS);
}

export function isExpired(retentionUntilDate: Date, now: Date = new Date()): boolean {
  return retentionUntilDate.getTime() <= now.getTime();
}

/** Documents due for the 7-day expiry notice, and not yet notified. */
export function needsExpiryNotice(
  doc: { retentionUntil: Date; retentionNoticeSentAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (doc.retentionNoticeSentAt !== null) return false;
  const days = daysUntilExpiry(doc.retentionUntil, now);
  return days > 0 && days <= POLICY.retention.expiryNoticeDays;
}

export interface RetentionChangePlan {
  readonly newRetentionDays: number;
  readonly previousRetentionDays: number;
  readonly isReduction: boolean;
  /**
   * Documents genuinely AT RISK: those whose new expiry falls at or before the
   * end of the transition window, and which therefore need the user to act.
   *
   * Deliberately not "every document whose window shortened". A document
   * uploaded last week under a 180-day policy still has months left under a
   * 90-day one; telling someone that eleven documents are at risk when only two
   * are would be alarming and false.
   */
  readonly affected: readonly {
    documentId: string;
    previousRetentionUntil: Date;
    newRetentionUntil: Date;
    /** The date after which the sweeper may actually delete it. */
    effectiveDeletionDate: Date;
  }[];
  /** When the transition window closes. Null when nothing shortens. */
  readonly transitionEndsAt: Date | null;
}

/**
 * Recompute retention after a plan change.
 *
 * Two rules make this safe:
 *   1. A LONGER window applies at once. There is no reason to delay a benefit.
 *   2. A SHORTER window never deletes immediately. Every affected document gets
 *      at least `POLICY.retention.transitionDays` from the change, so a user who
 *      downgrades on a Friday still has their documents on Monday.
 *
 * A document that would already have expired under the new window gets the full
 * transition window rather than being deleted on the spot, which is the case
 * that would otherwise lose someone their records with no warning.
 */
export function planRetentionChange(
  documents: readonly DocumentRetentionState[],
  previousRetentionDays: number,
  newRetentionDays: number,
  changedAt: Date = new Date(),
): RetentionChangePlan {
  const isReduction = newRetentionDays < previousRetentionDays;
  const transitionEnd = new Date(
    changedAt.getTime() + POLICY.retention.transitionDays * DAY_MS,
  );

  const affected: RetentionChangePlan['affected'] = documents
    .map((doc) => {
      const newUntil = new Date(doc.uploadedAt.getTime() + newRetentionDays * DAY_MS);
      return { doc, newUntil };
    })
    .filter(
      ({ doc, newUntil }) =>
        newUntil.getTime() < doc.retentionUntil.getTime() &&
        newUntil.getTime() <= transitionEnd.getTime(),
    )
    .map(({ doc, newUntil }) => ({
      documentId: doc.documentId,
      previousRetentionUntil: doc.retentionUntil,
      newRetentionUntil: newUntil,
      // Never earlier than the end of the transition window.
      effectiveDeletionDate: new Date(
        Math.max(newUntil.getTime(), transitionEnd.getTime()),
      ),
    }));

  return {
    newRetentionDays,
    previousRetentionDays,
    isReduction,
    affected,
    transitionEndsAt: affected.length > 0 ? transitionEnd : null,
  };
}

/**
 * Apply an increase immediately; an increase is always safe.
 * Returns the new retention date for a document.
 */
export function applyRetentionIncrease(
  doc: DocumentRetentionState,
  newRetentionDays: number,
): Date {
  const candidate = new Date(doc.uploadedAt.getTime() + newRetentionDays * DAY_MS);
  return candidate.getTime() > doc.retentionUntil.getTime()
    ? candidate
    : doc.retentionUntil;
}

/**
 * Customer-facing copy for a retention reduction. States facts, gives a date,
 * and says explicitly what is NOT affected, because that is the part people
 * actually worry about.
 */
export function retentionChangeMessage(
  plan: RetentionChangePlan,
  planDisplayName: string,
  locale = 'en-US',
): string | null {
  if (!plan.isReduction || plan.affected.length === 0 || plan.transitionEndsAt === null) {
    return null;
  }

  const count = plan.affected.length;
  const date = plan.transitionEndsAt.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    `Your ${planDisplayName} plan keeps documents for ${plan.newRetentionDays} days. ` +
    `${count} ${count === 1 ? 'document is' : 'documents are'} older than that. ` +
    `You can download ${count === 1 ? 'it' : 'them'} until ${date}, after which ` +
    `${count === 1 ? 'it' : 'they'} will be removed. Your cases, findings and ` +
    `letters stay in your account.`
  );
}

/**
 * What the sweeper should delete right now.
 *
 * Deliberately conservative: it only ever returns documents whose retention
 * date has genuinely passed. Everything else is somebody's medical paperwork.
 */
export function selectForDeletion(
  documents: readonly (DocumentRetentionState & { deletedAt: Date | null })[],
  now: Date = new Date(),
): readonly string[] {
  return documents
    .filter((doc) => doc.deletedAt === null && isExpired(doc.retentionUntil, now))
    .map((doc) => doc.documentId);
}
