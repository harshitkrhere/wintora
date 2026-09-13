/**
 * Support response targets.
 *
 * PRIORITY_SUPPORT is a promise about time, and a promise about time needs a
 * number. Until the operator has decided what they can honestly commit to,
 * both targets are null, `PRIORITY_SUPPORT.available` is false, and the
 * pricing and subscription pages say "included, not yet available" rather
 * than advertising a response time nobody has committed to.
 *
 * To switch the feature on: set `priorityHours` (and, ideally,
 * `standardHours` so the difference is visible), then re-run the tests.
 * `tests/feature-availability.test.ts` asserts the flag follows this file.
 *
 * Hours are business hours in the operator's working week, not wall-clock
 * hours, which is why the contact page states the working days alongside.
 */

export const SUPPORT = {
  /** Reply target for everyone, in working hours. Null until decided. */
  standardHours: null as number | null,
  /** Reply target for PRIORITY_SUPPORT plans, in working hours. Null until decided. */
  priorityHours: null as number | null,
  /** Stated on the contact page so "working hours" means something. */
  workingDays: 'Monday to Friday',
  /** The address support comes from, and the one to write to. */
  address: 'info@wintora.online',
} as const;

/** True once a priority target exists that can honestly be sold. */
export function prioritySupportAvailable(): boolean {
  return SUPPORT.priorityHours !== null && SUPPORT.priorityHours > 0;
}

/** One sentence for the contact page, from the same numbers. */
export function responseTargetSentence(priority: boolean): string | null {
  const hours = priority ? SUPPORT.priorityHours : SUPPORT.standardHours;
  if (hours === null || hours <= 0) return null;
  const unit = hours === 1 ? 'working hour' : 'working hours';
  return `We aim to reply within ${hours} ${unit}, ${SUPPORT.workingDays}.`;
}
