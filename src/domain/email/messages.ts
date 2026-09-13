/**
 * Every email the product sends, in one place.
 *
 * All of them go to the account holder and all of them are the same shape:
 * one plain fact about the account, one link into the app, nothing from any
 * case. No provider, no amount owed, no condition, no reminder title. An
 * inbox that is shared, forwarded or breached learns only that the person
 * uses the product and what their subscription is doing.
 *
 * Marketing does not live here and never will: no "we noticed you have not
 * been back", no "you have unused analyses". See docs/LIMITATIONS.md,
 * "Deliberate omissions".
 *
 * Each message is parts (heading, paragraphs, one button, a note) rendered
 * by ./layout into text and HTML together.
 *
 * Pure module: no I/O.
 */

import { renderEmail, type EmailMessage } from './layout';

export type { EmailMessage } from './layout';

function base(appUrl: string): string {
  return appUrl.replace(/\/+$/, '');
}

function longDate(d: Date): string {
  return d.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
}

/** After the first sign-in. One message, one thing to do. */
export function welcomeEmail(input: { appUrl: string }): EmailMessage {
  return renderEmail({
    subject: 'Welcome to Wintora',
    heading: 'Thanks for signing up',
    paragraphs: [
      'Wintora checks the arithmetic on a medical bill and helps you write to the billing office about it. It does not give advice and it never sends anything for you.',
      'To start: upload a bill, confirm the figures it reads, and the check runs from there.',
    ],
    cta: { label: 'Upload a bill', url: `${base(input.appUrl)}/upload` },
    note: 'Every case, document and result stays in your account until you remove it. You can export or delete everything at any time from Settings.',
  });
}

/** The deletion they asked for has happened. Sent while there is still an address. */
export function accountDeletedEmail(): EmailMessage {
  return renderEmail({
    subject: 'Your Wintora account has been deleted',
    heading: 'Your account has been deleted',
    paragraphs: [
      'As you asked, your Wintora account and everything in it have been removed: your cases, documents, checks, letters and reminders.',
      'What remains is a record that an account was deleted today and the billing records the law requires, kept apart from anything about your bills.',
    ],
    note: 'Backup copies expire on their own schedule. If you did not ask for this, reply to this message.',
  });
}

/** A renewal charge failed. They keep everything for the grace window. */
export function paymentFailedEmail(input: { appUrl: string; graceEnds: Date }): EmailMessage {
  return renderEmail({
    subject: 'Your Wintora renewal did not go through',
    heading: 'Your renewal did not go through',
    paragraphs: [
      'Your subscription renewal could not be charged. Cards expire and banks decline for ordinary reasons, so nothing has changed yet.',
      `You keep everything your plan includes until **${longDate(input.graceEnds)}**. If the payment has not gone through by then, your account moves to the Free plan; your cases, documents, findings and letters stay in your account either way.`,
    ],
    cta: { label: 'Update your card', url: `${base(input.appUrl)}/settings/subscription` },
  });
}

/** They cancelled. This is the acknowledgment several states require. */
export function subscriptionCanceledEmail(input: { appUrl: string; periodEnds: Date | null; planName: string }): EmailMessage {
  return renderEmail({
    subject: 'Your Wintora subscription is set to end',
    heading: 'Your subscription is set to end',
    paragraphs: [
      `You cancelled your ${input.planName} subscription. This confirms it; no further action is needed.`,
      input.periodEnds !== null
        ? `You keep everything ${input.planName} includes until **${longDate(input.periodEnds)}**, which is the end of the period you have paid for. You will not be charged again. After that date your account moves to the Free plan.`
        : 'You will not be charged again, and your account moves to the Free plan at the end of the period you have paid for.',
      'Your cases, documents, findings and letters stay in your account. Nothing is deleted because a plan changes.',
    ],
    cta: { label: 'Resume it instead', url: `${base(input.appUrl)}/settings/subscription` },
    note: 'Changed your mind? Resume any time before that date and nothing changes.',
  });
}

export function subscriptionPausedEmail(input: { appUrl: string; resumesBy: Date }): EmailMessage {
  return renderEmail({
    subject: 'Your Wintora subscription is paused',
    heading: 'Your subscription is paused',
    paragraphs: [
      'You are not being charged while it is paused, and your account is on the Free plan meanwhile. Nothing has been deleted.',
      `It resumes automatically on **${longDate(input.resumesBy)}**, or sooner if you resume it yourself.`,
    ],
    cta: { label: 'Your subscription', url: `${base(input.appUrl)}/settings/subscription` },
  });
}

export function subscriptionResumedEmail(input: { appUrl: string; planName: string }): EmailMessage {
  return renderEmail({
    subject: 'Your Wintora subscription is active again',
    heading: 'Your subscription is active again',
    paragraphs: [`Your ${input.planName} subscription has resumed and everything it includes is available again.`],
    cta: { label: 'Open Wintora', url: `${base(input.appUrl)}/dashboard` },
  });
}

/** The paid period ran out after a cancellation. Closure, not a pitch. */
export function subscriptionEndedEmail(input: { appUrl: string; planName: string }): EmailMessage {
  return renderEmail({
    subject: 'Your Wintora subscription has ended',
    heading: 'Your subscription has ended',
    paragraphs: [
      `Your ${input.planName} subscription has ended and your account is now on the Free plan.`,
      'Everything you made is still there: your cases, documents, findings and letters. The Free plan keeps one case open at a time; the rest stay readable.',
    ],
    cta: { label: 'Open Wintora', url: `${base(input.appUrl)}/dashboard` },
  });
}

/** Someone asked to delete the account. If it was not them, this is how they stop it. */
export function deletionRequestedEmail(input: { appUrl: string; executesOn: Date }): EmailMessage {
  return renderEmail({
    subject: 'Your Wintora account is scheduled for deletion',
    heading: 'Your account is scheduled for deletion',
    paragraphs: [
      `A request to delete your Wintora account was made from your signed-in session. The deletion happens on **${longDate(input.executesOn)}**; until then nothing is removed.`,
      'If that was you, there is nothing more to do.',
    ],
    cta: { label: 'Cancel the deletion', url: `${base(input.appUrl)}/settings/privacy` },
    note: 'If it was not you, cancel the deletion now and change your password.',
  });
}

/**
 * The annual renewal notice. Several US states require one 15 to 45 days
 * before a subscription of a year or more renews, and require it to say that
 * it will renew, when, for how much, and how to cancel. All four are here.
 */
export function renewalReminderEmail(input: {
  appUrl: string;
  planName: string;
  renewsOn: Date;
  priceFormatted: string;
}): EmailMessage {
  return renderEmail({
    subject: `Your Wintora ${input.planName} plan renews on ${longDate(input.renewsOn)}`,
    heading: `Your ${input.planName} plan renews on ${longDate(input.renewsOn)}`,
    paragraphs: [
      `Your yearly ${input.planName} subscription renews automatically on **${longDate(input.renewsOn)}**, when **${input.priceFormatted}** will be charged to the card on file for another year.`,
      'If you want to keep it, there is nothing to do.',
      'If you do not, cancel before that date and you will not be charged; you keep everything the plan includes until then, and your cases stay in your account afterwards.',
    ],
    cta: { label: 'Manage your subscription', url: `${base(input.appUrl)}/settings/subscription` },
  });
}

/** A date the customer entered on a case is tomorrow. */
export function dateTomorrowEmail(input: { appUrl: string; caseId: string }): EmailMessage {
  return renderEmail({
    subject: 'A date you entered on a case is tomorrow',
    heading: 'A date you entered is tomorrow',
    paragraphs: ['One of the dates you entered on a case falls tomorrow. Open the case to see what it is.'],
    cta: { label: 'Open the case', url: `${base(input.appUrl)}/cases/${input.caseId}` },
    note: 'This is a date you wrote down yourself; Wintora has not verified it. Mark it done on the case page to stop this message.',
  });
}

/**
 * A case has a document and no letter has gone, and nothing has happened on
 * it for a few days. One message per case, ever: what is there, what is not,
 * one link. No urgency, because there is none we know of.
 */
export function unsentLetterEmail(input: { appUrl: string; caseId: string; documentCount: number }): EmailMessage {
  const docs = input.documentCount === 1 ? 'a document' : `${input.documentCount} documents`;
  return renderEmail({
    subject: 'Your case has a bill on it and no letter yet',
    heading: 'A bill is on your case, and no letter has gone out',
    paragraphs: [
      `You uploaded ${docs} to a case a few days ago. The check has run, or is ready to, and no letter to the billing office has been marked as sent.`,
      'If the bill is settled, there is nothing to do. If not, the case page has the findings and a letter you can prepare from them.',
    ],
    cta: { label: 'Open the case', url: `${base(input.appUrl)}/cases/${input.caseId}` },
    note: 'This is the only message Wintora sends about a case on its own, and it is sent once. Close the case if you are done with it.',
  });
}
