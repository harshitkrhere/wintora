/**
 * Sending a letter yourself: list input, the email subject, the mailto link,
 * and the follow-up date. All derived from the confirmed letter.
 */

import { describe, expect, it } from 'vitest';
import { followUpDate, mailtoLink, splitListInput, subjectFor } from '@/domain/letters/send';

const LETTER = [
  'September 13, 2026',
  '',
  'CityCare Multispeciality Hospital',
  '',
  'Re: Questions about my statement',
  'Account reference: ACC-987654321',
  '',
  'To whom it may concern,',
  '',
  'My questions are:',
  '',
  '1. Detailed itemization of the facility fees.',
  '',
  'Thank you,',
  '',
  'Harshit',
].join('\n');

describe('splitListInput', () => {
  it('splits on line breaks', () => {
    expect(splitListInput('one\ntwo\n\nthree')).toEqual(['one', 'two', 'three']);
  });

  // Exactly what a real customer typed: three numbered points on one line,
  // which the letter then numbered again ("1. 1. ...2. ...3. ...").
  it('splits an inline enumeration and drops the typed numbers', () => {
    expect(
      splitListInput('1. Detailed itemization of the facility fees.2. Breakdown of the lab charges.3. Clarification on the pharmacy costs.'),
    ).toEqual([
      'Detailed itemization of the facility fees.',
      'Breakdown of the lab charges.',
      'Clarification on the pharmacy costs.',
    ]);
    expect(splitListInput('1) first 2) second')).toEqual(['first', 'second']);
    expect(splitListInput('- first\n- second\n• third')).toEqual(['first', 'second', 'third']);
  });

  it('does not split a decimal or a dosage', () => {
    expect(splitListInput('Ibuprofen 10.5 mg was charged twice')).toEqual(['Ibuprofen 10.5 mg was charged twice']);
    expect(splitListInput('Room charge of 1,500.00 per day')).toEqual(['Room charge of 1,500.00 per day']);
  });
});

describe('subjectFor and mailtoLink', () => {
  it('uses the Re: line and adds the account reference', () => {
    expect(subjectFor(LETTER, 'Ask for clarification')).toBe('Questions about my statement (ACC-987654321)');
    expect(subjectFor('Dear sir', 'Ask for clarification')).toBe('Ask for clarification');
  });

  it('opens the mail app with the subject and the whole letter when it fits', () => {
    const { href, bodyIncluded } = mailtoLink({ content: LETTER, title: 'T', to: 'billing@example.com' });
    expect(href.startsWith('mailto:billing%40example.com?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('subject=Questions about my statement (ACC-987654321)');
    expect(decodeURIComponent(href)).toContain('body=September 13, 2026');
    expect(bodyIncluded).toBe(true);
  });

  it('ignores a malformed address and shortens a long body', () => {
    const long = `${LETTER}\n${'x'.repeat(3000)}`;
    const { href, bodyIncluded } = mailtoLink({ content: long, title: 'T', to: 'not an address' });
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    expect(bodyIncluded).toBe(false);
    expect(decodeURIComponent(href)).toContain('Please find my letter attached.');
    expect(decodeURIComponent(href)).toContain('Account reference: ACC-987654321');
  });
});

describe('followUpDate', () => {
  it('is fourteen days later, on the calendar', () => {
    expect(followUpDate(new Date('2026-09-13T23:30:00Z'))).toBe('2026-09-27');
    expect(followUpDate(new Date('2026-12-25T00:00:00Z'))).toBe('2027-01-08');
    expect(followUpDate(new Date('2026-09-13T00:00:00Z'), 1)).toBe('2026-09-14');
  });
});
