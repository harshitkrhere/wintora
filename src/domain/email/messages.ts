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
 * Pure module: no I/O.
 */

export interface EmailMessage {
  readonly subject: string;
  readonly text: string;
}

const SIGN_OFF = [
  '',
  'Wintora',
  'Reply to this email if something here is wrong or unclear; a person reads it.',
];

function base(appUrl: string): string {
  return appUrl.replace(/\/+$/, '');
}

function longDate(d: Date): string {
  return d.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
}

function lines(parts: readonly string[]): string {
  return [...parts, ...SIGN_OFF].join('\n');
}

/** After the first sign-in. One message, one thing to do. */
export function welcomeEmail(input: { appUrl: string }): EmailMessage {
  const url = base(input.appUrl);
  return {
    subject: 'Welcome to Wintora',
    text: lines([
      'Thanks for signing up.',
      '',
      'Wintora checks the arithmetic on a medical bill and helps you write to the billing office about it. It does not give advice and it never sends anything for you.',
      '',
      'To start: upload a bill, confirm the figures it reads, and the check runs from there.',
      `${url}/upload`,
      '',
      'Every case, document and result stays in your account until you remove it. You can export or delete everything at any time from Settings.',
    ]),
  };
}

/** A renewal charge failed. They keep everything for the grace window. */
export function paymentFailedEmail(input: { appUrl: string; graceEnds: Date }): EmailMessage {
  const url = base(input.appUrl);
  return {
    subject: 'Your Wintora renewal did not go through',
    text: lines([
      'Your subscription renewal could not be charged. Cards expire and banks decline for ordinary reasons, so nothing has changed yet.',
      '',
      `You keep everything your plan includes until ${longDate(input.graceEnds)}. If the payment has not gone through by then, your account moves to the Free plan; your cases, documents, findings and letters stay in your account either way.`,
      '',
      'To update your card:',
      `${url}/settings/subscription`,
    ]),
  };
}

/** They cancelled. This is the acknowledgment several states require. */
export function subscriptionCanceledEmail(input: { appUrl: string; periodEnds: Date | null; planName: string }): EmailMessage {
  const url = base(input.appUrl);
  return {
    subject: 'Your Wintora subscription is set to end',
    text: lines([
      `You cancelled your ${input.planName} subscription. This confirms it; no further action is needed.`,
      '',
      input.periodEnds !== null
        ? `You keep everything ${input.planName} includes until ${longDate(input.periodEnds)}, which is the end of the period you have paid for. You will not be charged again. After that date your account moves to the Free plan.`
        : 'You will not be charged again, and your account moves to the Free plan at the end of the period you have paid for.',
      '',
      'Your cases, documents, findings and letters stay in your account. Nothing is deleted because a plan changes.',
      '',
      'Changed your mind? Resume it any time before then:',
      `${url}/settings/subscription`,
    ]),
  };
}

export function subscriptionPausedEmail(input: { appUrl: string; resumesBy: Date }): EmailMessage {
  const url = base(input.appUrl);
  return {
    subject: 'Your Wintora subscription is paused',
    text: lines([
      'Your subscription is paused. You are not being charged while it is paused, and your account is on the Free plan meanwhile. Nothing has been deleted.',
      '',
      `It resumes automatically on ${longDate(input.resumesBy)}, or sooner if you resume it yourself:`,
      `${url}/settings/subscription`,
    ]),
  };
}

export function subscriptionResumedEmail(input: { appUrl: string; planName: string }): EmailMessage {
  const url = base(input.appUrl);
  return {
    subject: 'Your Wintora subscription is active again',
    text: lines([
      `Your ${input.planName} subscription has resumed and everything it includes is available again.`,
      '',
      `${url}/dashboard`,
    ]),
  };
}

/** The paid period ran out after a cancellation. Closure, not a pitch. */
export function subscriptionEndedEmail(input: { appUrl: string; planName: string }): EmailMessage {
  const url = base(input.appUrl);
  return {
    subject: 'Your Wintora subscription has ended',
    text: lines([
      `Your ${input.planName} subscription has ended and your account is now on the Free plan.`,
      '',
      'Everything you made is still there: your cases, documents, findings and letters. The Free plan keeps one case open at a time; the rest stay readable.',
      '',
      `${url}/dashboard`,
    ]),
  };
}

/** Someone asked to delete the account. If it was not them, this is how they stop it. */
export function deletionRequestedEmail(input: { appUrl: string; executesOn: Date }): EmailMessage {
  const url = base(input.appUrl);
  return {
    subject: 'Your Wintora account is scheduled for deletion',
    text: lines([
      `A request to delete your Wintora account was made from your signed-in session. The deletion happens on ${longDate(input.executesOn)}; until then nothing is removed.`,
      '',
      'If that was you, there is nothing more to do.',
      '',
      'If it was not you, cancel the deletion now and change your password:',
      `${url}/settings/privacy`,
    ]),
  };
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
  const url = base(input.appUrl);
  return {
    subject: `Your Wintora ${input.planName} plan renews on ${longDate(input.renewsOn)}`,
    text: lines([
      `Your yearly ${input.planName} subscription renews automatically on ${longDate(input.renewsOn)}, when ${input.priceFormatted} will be charged to the card on file for another year.`,
      '',
      'If you want to keep it, there is nothing to do.',
      '',
      'If you do not, cancel before that date and you will not be charged; you keep everything the plan includes until then, and your cases stay in your account afterwards:',
      `${url}/settings/subscription`,
    ]),
  };
}

/** A date the customer entered on a case is tomorrow. */
export function dateTomorrowEmail(input: { appUrl: string; caseId: string }): EmailMessage {
  const url = base(input.appUrl);
  return {
    subject: 'A date you entered on a case is tomorrow',
    text: lines([
      'One of the dates you entered on a case falls tomorrow.',
      '',
      `Open the case to see what it is: ${url}/cases/${input.caseId}`,
      '',
      'This is a date you wrote down yourself; Wintora has not verified it. Mark it done on the case page to stop this message.',
    ]),
  };
}
