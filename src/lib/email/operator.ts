/**
 * A note to whoever runs Wintora, at the sending address itself.
 *
 * Some things a customer asks for are done by a person for now: a copy of
 * their data is one. The request is recorded in privacy_requests with a
 * statutory due date, but a row nobody looks at is a deadline nobody meets,
 * so the operator is also told by email the moment it is made.
 *
 * Not logged in email_log, which is per customer; never sent to a customer;
 * never throws. With no email provider configured it is only logged, and the
 * request row remains the record.
 */

import { getEmailSender, parseFrom } from '@/lib/email';
import { serverEnv } from '@/lib/env';
import { log } from '@/lib/logging';

export type OperatorNoticeOutcome = 'sent' | 'no_sender' | 'failed';

export async function notifyOperator(input: { subject: string; text: string }): Promise<OperatorNoticeOutcome> {
  const sender = getEmailSender();
  if (sender === null) {
    log.warn('operator notice not sent: no email provider', { route: 'email.notifyOperator', subject: input.subject });
    return 'no_sender';
  }
  try {
    await sender.send({
      to: parseFrom(serverEnv().EMAIL_FROM).address,
      subject: `[Wintora] ${input.subject}`,
      text: input.text,
    });
    return 'sent';
  } catch (error) {
    log.warn('operator notice failed', {
      route: 'email.notifyOperator',
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
    return 'failed';
  }
}
