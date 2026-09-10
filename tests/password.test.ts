/**
 * Password rules.
 *
 * Length is the rule that actually resists offline cracking. Composition rules
 * mostly push people toward `Password1!`, so there are none — which makes it
 * worth pinning that the few obvious long passwords are still refused.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isAcceptablePassword,
  passwordProblem,
} from '@/lib/auth/password';

describe('length', () => {
  it('requires at least the documented minimum', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordProblem('short')).toContain('12 characters');
    expect(passwordProblem('elevenchars')).not.toBeNull();
  });

  it('accepts a passphrase at exactly the minimum', () => {
    expect(passwordProblem('a'.repeat(11) + 'b')).toBeNull();
  });

  it('refuses something absurdly long rather than hashing it', () => {
    expect(passwordProblem('x'.repeat(MAX_PASSWORD_LENGTH + 1))).not.toBeNull();
  });
});

describe('obviously bad passwords that clear the length rule', () => {
  it.each([
    'password1234',
    'passwordpassword',
    '123456789012',
    'qwertyuiop12',
    'letmeinletmein',
  ])('%s is refused', (password) => {
    expect(isAcceptablePassword(password)).toBe(false);
  });

  it('normalises case and spacing before comparing', () => {
    expect(isAcceptablePassword('Password1234')).toBe(false);
    expect(isAcceptablePassword('PASS WORD 1234')).toBe(false);
  });

  it('refuses a single repeated character', () => {
    expect(isAcceptablePassword('aaaaaaaaaaaaaaa')).toBe(false);
    expect(passwordProblem('bbbbbbbbbbbbbb')).toContain('repeated character');
  });
});

describe('good passwords', () => {
  it.each([
    'correct horse battery staple',
    'the-quiet-heron-flew-north',
    'Tr0ub4dor&3xtra-long-enough',
    'mysupersecretpassphrase',
  ])('%s is accepted', (password) => {
    expect(isAcceptablePassword(password)).toBe(true);
  });

  it('does not demand symbols, digits or mixed case', () => {
    // The whole point: a long lowercase phrase is stronger than P@ss1.
    expect(isAcceptablePassword('a passphrase of only lowercase words')).toBe(true);
  });
});

describe('messages', () => {
  it('are specific and actionable', () => {
    const message = passwordProblem('short')!;
    expect(message).toMatch(/at least 12/);
    // Explains why, so the rule does not read as arbitrary.
    expect(message).toMatch(/length matters/i);
  });

  it('return null when there is nothing wrong', () => {
    expect(passwordProblem('a perfectly reasonable passphrase')).toBeNull();
  });
});
