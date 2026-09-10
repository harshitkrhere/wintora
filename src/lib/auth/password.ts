/**
 * Password rules.
 *
 * Length first, because length is what actually resists offline cracking.
 * Composition rules ("one uppercase, one digit, one symbol") mostly push people
 * toward `Password1!`, so there are none here beyond a check against the
 * obvious choices.
 *
 * Breached-password rejection is a Supabase Auth project setting rather than
 * something implemented here: they can check against a corpus we do not have.
 * Enabling it is listed in docs/LIMITATIONS.md.
 *
 * Pure module: no I/O.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 400;

/**
 * Passwords that a length rule alone would wave through. Not a substitute for
 * a real breached-password list, just the handful that clear 12 characters and
 * still appear near the top of every leak.
 */
const OBVIOUS = [
  'password1234',
  'passwordpassword',
  '123456789012',
  'qwertyuiop12',
  'letmeinletmein',
  'iloveyouiloveyou',
  'administrator',
  'wintorawintora',
];

/** Returns a specific, actionable message, or null when the password is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Please use at least ${MIN_PASSWORD_LENGTH} characters. Length matters far more than mixing in symbols.`;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `That password is longer than ${MAX_PASSWORD_LENGTH} characters.`;
  }

  const normalised = password.toLowerCase().replace(/\s+/g, '');

  if (OBVIOUS.includes(normalised)) {
    return 'That password appears in every list of common passwords. Please choose another.';
  }

  // A single repeated character clears a length check trivially.
  if (/^(.)\1+$/.test(password)) {
    return 'That password is a single repeated character. Please choose another.';
  }

  return null;
}

export function isAcceptablePassword(password: string): boolean {
  return passwordProblem(password) === null;
}
