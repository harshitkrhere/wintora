/**
 * Who gets the one unprompted message about a case.
 *
 * A case qualifies when it has an accepted document, no letter has been
 * marked sent, and nothing has happened on it for three full days. That
 * last condition is measured from the latest thing on the case: its last
 * timeline entry or its last change, whichever is later. A closed case never
 * qualifies; the person has said they are done.
 *
 * "Once per case, ever" is enforced by the email log's key, not here; this
 * only answers whether a case is eligible right now.
 *
 * Pure module: no I/O.
 */

export const NUDGE_AFTER_DAYS = 3;

export interface NudgeCandidate {
  readonly status: string;
  readonly documentCount: number;
  readonly sentLetterCount: number;
  /** ISO instants of the most recent thing on the case; null when none. */
  readonly lastEventAt: string | null;
  readonly updatedAt: string;
}

export function nudgeEligible(c: NudgeCandidate, now: Date): boolean {
  if (c.status !== 'OPEN') return false;
  if (c.documentCount < 1) return false;
  if (c.sentLetterCount > 0) return false;
  const last = Math.max(Date.parse(c.updatedAt), c.lastEventAt !== null ? Date.parse(c.lastEventAt) : 0);
  if (!Number.isFinite(last) || last === 0) return false;
  return now.getTime() - last >= NUDGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** The email log key that makes the message once per case, ever. */
export function nudgeKey(caseId: string): string {
  return `email_nudge_unsent_${caseId}`;
}
