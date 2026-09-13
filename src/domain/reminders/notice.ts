/**
 * Reminders and dates: what is due, and what the email says.
 *
 * Two kinds of date live on a case and they are kept apart on purpose:
 *
 *   A reminder is something the customer asked to be told about: "follow up
 *   on the 20th". It is theirs, it can be anything, and it is sent to them.
 *
 *   A deadline is a date that matters to the case. It is VERIFIED only when a
 *   reviewed source is cited (the database refuses a verified deadline with no
 *   source); otherwise it is shown as the customer's own note. Nothing here
 *   turns a note into a verified date, and no deadline is ever invented from a
 *   document.
 *
 * Pure module: no I/O.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DueItem {
  readonly id: string;
  readonly caseId: string;
  readonly caseTitle: string;
  readonly kind: 'reminder' | 'deadline';
  readonly label: string;
  /** ISO instant for a reminder; YYYY-MM-DD for a deadline. */
  readonly at: string;
  readonly verified: boolean;
  readonly completed: boolean;
}

/** A reminder is due once its time has passed and nobody has completed it. */
export function isReminderDue(remindAt: Date, completedAt: Date | null, now: Date): boolean {
  return completedAt === null && remindAt.getTime() <= now.getTime();
}

/** Calendar days from today (UTC) to a YYYY-MM-DD date. Negative when past. */
export function daysUntil(dueDate: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  return Math.round((due - today) / DAY_MS);
}

/**
 * The items worth showing on the home page: anything overdue, and anything
 * within the window, soonest first. Completed items are never shown here.
 */
export function upcoming(items: readonly DueItem[], now: Date, withinDays = 14): DueItem[] {
  const horizon = now.getTime() + withinDays * DAY_MS;
  return items
    .filter((i) => !i.completed)
    .filter((i) => {
      const t = i.kind === 'deadline' ? Date.parse(`${i.at}T23:59:59Z`) : Date.parse(i.at);
      return Number.isFinite(t) && t <= horizon;
    })
    .sort((a, b) => timeOf(a) - timeOf(b));
}

function timeOf(item: DueItem): number {
  return item.kind === 'deadline' ? Date.parse(`${item.at}T00:00:00Z`) : Date.parse(item.at);
}

/**
 * The reminder email. It names nothing from the case: not the provider, not
 * the amount, not the reminder's own title, which the customer wrote and may
 * have put anything in. The link opens the case, where all of that is.
 */
export function reminderEmail(input: { appUrl: string; caseId: string }): {
  subject: string;
  text: string;
} {
  const url = `${input.appUrl.replace(/\/+$/, '')}/cases/${input.caseId}`;
  return {
    subject: 'A reminder you set is due',
    text: [
      'You asked Wintora to remind you about one of your cases today.',
      '',
      `Open the case to see what you wrote: ${url}`,
      '',
      'This message was sent because you set a reminder. Wintora has not contacted anyone else.',
      'To stop reminders, mark them done or delete them on the case page.',
    ].join('\n'),
  };
}

/** The same rule for the retention notice, so both messages read alike. */
export function retentionNoticeEmail(input: { appUrl: string; caseId: string | null; removesOn: Date }): {
  subject: string;
  text: string;
} {
  const base = input.appUrl.replace(/\/+$/, '');
  const url = input.caseId !== null ? `${base}/cases/${input.caseId}` : `${base}/cases`;
  const date = input.removesOn.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
  return {
    subject: 'A document on your account is due to be removed',
    text: [
      `One of the documents you uploaded reaches the end of its retention period on ${date} and will be removed then, as your plan sets out.`,
      '',
      `If you want to keep a copy, download it before that date: ${url}`,
      '',
      'Your case, its checks and its letters are not affected; only the uploaded file is removed.',
    ].join('\n'),
  };
}
