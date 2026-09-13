/**
 * Support response targets.
 *
 * PRIORITY_SUPPORT is a promise about time, and a promise about time needs a
 * number. Both targets live here and nowhere else: the contact page, the
 * feature registry (`PRIORITY_SUPPORT.available`) and the tests all read
 * this file, so the words on the page and the flag on the plan cannot drift
 * from the commitment. Setting `priorityHours` back to null withdraws the
 * feature everywhere at once; `tests/feature-availability.test.ts` asserts
 * the flag follows this file.
 *
 * Hours are business hours in the operator's working week, not wall-clock
 * hours, which is why the contact page states the working days alongside.
 */

export const SUPPORT = {
  /**
   * Reply target for everyone, in working hours. Two working days: what the
   * contact page has promised since launch, and what a solo operator who is
   * also building the product can keep on a bad week.
   */
  standardHours: 16 as number | null,
  /**
   * Reply target for PRIORITY_SUPPORT plans, in working hours. One working
   * day. Decided 13 September 2026; this is the number Pro is sold on, so
   * lengthening it is a change to a paid promise and needs telling customers.
   */
  priorityHours: 8 as number | null,
  /** Stated on the contact page so "working hours" means something. */
  workingDays: 'Monday to Friday',
  /** The address support comes from, and the one to write to. */
  address: 'info@wintora.online',
} as const;

/** True once a priority target exists that can honestly be sold. */
export function prioritySupportAvailable(): boolean {
  return SUPPORT.priorityHours !== null && SUPPORT.priorityHours > 0;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];

/** "one working day", "two working days", "4 working hours". */
export function responseTargetPhrase(hours: number): string {
  if (hours % 8 === 0) {
    const days = hours / 8;
    return `${WORDS[days] ?? String(days)} working ${days === 1 ? 'day' : 'days'}`;
  }
  return `${hours} working ${hours === 1 ? 'hour' : 'hours'}`;
}

/** One sentence for the contact page, from the same numbers. */
export function responseTargetSentence(priority: boolean): string | null {
  const hours = priority ? SUPPORT.priorityHours : SUPPORT.standardHours;
  if (hours === null || hours <= 0) return null;
  return `We aim to reply within ${responseTargetPhrase(hours)}, ${SUPPORT.workingDays}.`;
}
