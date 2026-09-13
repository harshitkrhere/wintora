/**
 * Every email the product sends: what each must say, and what none may.
 */

import { describe, expect, it } from 'vitest';
import {
  dateTomorrowEmail,
  deletionRequestedEmail,
  paymentFailedEmail,
  renewalReminderEmail,
  subscriptionCanceledEmail,
  subscriptionEndedEmail,
  subscriptionPausedEmail,
  subscriptionResumedEmail,
  welcomeEmail,
} from '@/domain/email/messages';
import { reminderEmail, retentionNoticeEmail } from '@/domain/reminders/notice';

const appUrl = 'https://www.wintora.online/';
const d = (s: string): Date => new Date(`${s}T12:00:00Z`);

const ALL = [
  welcomeEmail({ appUrl }),
  paymentFailedEmail({ appUrl, graceEnds: d('2026-09-20') }),
  subscriptionCanceledEmail({ appUrl, periodEnds: d('2026-10-13'), planName: 'Plus' }),
  subscriptionPausedEmail({ appUrl, resumesBy: d('2026-12-12') }),
  subscriptionResumedEmail({ appUrl, planName: 'Plus' }),
  subscriptionEndedEmail({ appUrl, planName: 'Plus' }),
  deletionRequestedEmail({ appUrl, executesOn: d('2026-09-20') }),
  renewalReminderEmail({ appUrl, planName: 'Plus', renewsOn: d('2026-10-13'), priceFormatted: '$199.00' }),
  dateTomorrowEmail({ appUrl, caseId: 'abc' }),
  reminderEmail({ appUrl, caseId: 'abc' }),
  retentionNoticeEmail({ appUrl, caseId: 'abc', removesOn: d('2026-09-20') }),
];

describe('every email', () => {
  it('has a subject, a link into the app, and no double slash from the base url', () => {
    for (const m of ALL) {
      expect(m.subject.length).toBeGreaterThan(8);
      expect(m.text).toMatch(/https:\/\/www\.wintora\.online\/[a-z]/);
      expect(m.text).not.toContain('online//');
    }
  });

  // The shape rule: nothing from a case, ever. These words would only appear
  // if a message started carrying case content.
  it('names nothing from a case', () => {
    for (const m of ALL) {
      expect(`${m.subject}\n${m.text}`).not.toMatch(/hospital|clinic|diagnos|\$\d+\.\d\d owed|amount due|provider name/i);
    }
  });

  it('never pretends to have sent anything for the customer', () => {
    for (const m of ALL) expect(m.text).not.toMatch(/we (have )?sent (your|the) letter/i);
  });
});

describe('what each must say', () => {
  it('payment failed: the grace date and where to fix it', () => {
    const m = paymentFailedEmail({ appUrl, graceEnds: d('2026-09-20') });
    expect(m.text).toContain('September 20, 2026');
    expect(m.text).toContain('/settings/subscription');
    expect(m.text).toContain('stay in your account');
  });

  it('cancellation: an acknowledgment, the end date, no further charge, how to resume', () => {
    const m = subscriptionCanceledEmail({ appUrl, periodEnds: d('2026-10-13'), planName: 'Plus' });
    expect(m.text).toContain('This confirms it');
    expect(m.text).toContain('October 13, 2026');
    expect(m.text).toContain('will not be charged again');
    expect(m.text).toContain('/settings/subscription');
  });

  // The four things the auto-renewal statutes ask for, in one message.
  it('renewal reminder: will renew, when, for how much, how to cancel', () => {
    const m = renewalReminderEmail({ appUrl, planName: 'Plus', renewsOn: d('2026-10-13'), priceFormatted: '$199.00' });
    expect(m.subject).toContain('renews on October 13, 2026');
    expect(m.text).toContain('renews automatically on October 13, 2026');
    expect(m.text).toContain('$199.00');
    expect(m.text).toContain('cancel before that date');
    expect(m.text).toContain('/settings/subscription');
  });

  it('deletion request: the date, and how to stop it if it was not them', () => {
    const m = deletionRequestedEmail({ appUrl, executesOn: d('2026-09-20') });
    expect(m.text).toContain('September 20, 2026');
    expect(m.text).toContain('If it was not you');
    expect(m.text).toContain('/settings/privacy');
  });

  it('welcome: one thing to do, and the promise about their data', () => {
    const m = welcomeEmail({ appUrl });
    expect(m.text).toContain('/upload');
    expect(m.text).toContain('never sends anything for you');
    expect(m.text).toContain('export or delete everything');
  });

  it('date tomorrow: says it is their own date, not a verified one', () => {
    const m = dateTomorrowEmail({ appUrl, caseId: 'abc' });
    expect(m.text).toContain('/cases/abc');
    expect(m.text).toContain('has not verified it');
  });
});
