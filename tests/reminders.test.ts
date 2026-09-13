/**
 * Reminders and dates: what is due, and what the email is allowed to say.
 */

import { describe, expect, it } from 'vitest';
import { daysUntil, isReminderDue, reminderEmail, retentionNoticeEmail, upcoming, type DueItem } from '@/domain/reminders/notice';

const now = new Date('2026-09-13T10:00:00Z');

describe('due logic', () => {
  it('a reminder is due once its time has passed and it is not done', () => {
    expect(isReminderDue(new Date('2026-09-13T09:00:00Z'), null, now)).toBe(true);
    expect(isReminderDue(new Date('2026-09-13T11:00:00Z'), null, now)).toBe(false);
    expect(isReminderDue(new Date('2026-09-13T09:00:00Z'), new Date('2026-09-13T09:30:00Z'), now)).toBe(false);
  });

  it('counts calendar days to a date, negative when past', () => {
    expect(daysUntil('2026-09-13', now)).toBe(0);
    expect(daysUntil('2026-09-20', now)).toBe(7);
    expect(daysUntil('2026-09-10', now)).toBe(-3);
  });

  it('lists overdue and upcoming items soonest first, and never completed ones', () => {
    const items: DueItem[] = [
      { id: 'a', caseId: 'c', caseTitle: 'C', kind: 'deadline', label: 'Reply by', at: '2026-09-25', verified: false, completed: false },
      { id: 'b', caseId: 'c', caseTitle: 'C', kind: 'reminder', label: 'Call', at: '2026-09-12T09:00:00Z', verified: false, completed: false },
      { id: 'c', caseId: 'c', caseTitle: 'C', kind: 'reminder', label: 'Done', at: '2026-09-12T09:00:00Z', verified: false, completed: true },
      { id: 'd', caseId: 'c', caseTitle: 'C', kind: 'deadline', label: 'Far', at: '2026-12-01', verified: true, completed: false },
      { id: 'e', caseId: 'c', caseTitle: 'C', kind: 'reminder', label: 'Soon', at: '2026-09-14T09:00:00Z', verified: false, completed: false },
    ];
    expect(upcoming(items, now, 14).map((i) => i.id)).toEqual(['b', 'e', 'a']);
  });
});

describe('what the emails say', () => {
  it('the reminder email links to the case and names nothing from it', () => {
    const { subject, text } = reminderEmail({ appUrl: 'https://wintora.online/', caseId: 'abc' });
    expect(subject).toBe('A reminder you set is due');
    expect(text).toContain('https://wintora.online/cases/abc');
    // The customer's own title is not repeated, because they may have put
    // anything in it and the inbox may not be theirs alone.
    expect(text).not.toMatch(/\$|provider|hospital|diagnos/i);
  });

  it('the retention notice gives the date and the way to keep a copy', () => {
    const { text } = retentionNoticeEmail({ appUrl: 'https://wintora.online', caseId: null, removesOn: new Date('2026-09-20T00:00:00Z') });
    expect(text).toContain('September 20, 2026');
    expect(text).toContain('https://wintora.online/cases');
    expect(text).toContain('only the uploaded file is removed');
  });
});
