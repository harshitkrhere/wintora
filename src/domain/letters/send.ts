/**
 * Sending a letter yourself: the words and the links.
 *
 * Wintora never sends. What it can do is make the customer's own sending
 * easy and obvious: open their mail app with the subject and text filled in,
 * say where on a statement the billing address usually is, and suggest when
 * to follow up. Everything here is derived from the letter the customer has
 * already confirmed; nothing is composed.
 *
 * Pure module: no I/O.
 */

export type SendRoute = 'email' | 'post' | 'portal' | 'fax' | 'other';

/** How long a billing office is typically given before a polite follow-up. */
export const FOLLOW_UP_AFTER_DAYS = 14;

/** Splits user-typed list input into entries, so "1. a 2. b" is two items, not one. */
export function splitListInput(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (text.length === 0) return [];

  // Break on line ends, and on an inline enumeration ("2." / "3)") that
  // follows sentence-ending punctuation or whitespace. "10.5 mg" is left
  // alone: the marker must be preceded by punctuation or a space and
  // followed by a space.
  const pieces = text
    .split(/\n+|(?<=[.;:!?)]|\s)\s*(?=\(?\d{1,2}[.)]\s+[A-Za-z(])/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Strip the marker the customer typed, since the letter numbers its own.
  return pieces
    .map((p) => p.replace(/^\(?\d{1,2}[.)]\s+/, '').replace(/^[-*•]\s+/, '').trim())
    .filter((p) => p.length > 0);
}

/**
 * The email subject, from the letter's own "Re:" line. Falls back to the
 * template's title, and adds the account reference when the letter states
 * one, because that is what a billing office searches on.
 */
export function subjectFor(content: string, title: string): string {
  const re = /^Re:\s*(.+)$/m.exec(content);
  const subject = (re?.[1] ?? title).trim();
  const ref = /^(?:Account|Member|Claim)\s+reference:\s*(.+)$/m.exec(content);
  return ref !== null && !subject.includes(ref[1]!.trim())
    ? `${subject} (${ref[1]!.trim()})`
    : subject;
}

/**
 * A mailto: link that opens the customer's own mail app. The body carries the
 * whole letter when it fits; mail clients cap a mailto URL at roughly 2,000
 * characters, so a long letter gets a short body and the PDF goes as an
 * attachment. Either way the customer presses Send, not us.
 */
export function mailtoLink(input: { content: string; title: string; to?: string }): {
  href: string;
  bodyIncluded: boolean;
} {
  const subject = subjectFor(input.content, input.title);
  const full = input.content.replace(/\r\n?/g, '\n');
  const short =
    'Please find my letter attached.\n\n' +
    `${/^Re:.*$/m.exec(full)?.[0] ?? subject}\n` +
    `${/^(?:Account|Member|Claim)\s+reference:.*$/m.exec(full)?.[0] ?? ''}`.trim();
  const bodyIncluded = encodeURIComponent(full).length <= 1700;
  const body = bodyIncluded ? full : short;
  const to = input.to !== undefined && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to) ? input.to : '';
  return {
    href: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    bodyIncluded,
  };
}

/** YYYY-MM-DD, n days after a date, in UTC. */
export function followUpDate(sentOn: Date, days = FOLLOW_UP_AFTER_DAYS): string {
  const d = new Date(Date.UTC(sentOn.getUTCFullYear(), sentOn.getUTCMonth(), sentOn.getUTCDate() + days));
  return d.toISOString().slice(0, 10);
}
