/**
 * Letter rendering.
 *
 * The template engine is deliberately tiny: substitution and presence sections,
 * nothing else. A template is data from the database, and anything more
 * powerful would be an execution surface.
 */

import { describe, expect, it } from 'vitest';
import {
  canFinalize,
  prefillFromCase,
  renderLetter,
  validateFields,
  type LetterTemplate,
} from '@/domain/letters/render';

const TEMPLATE: LetterTemplate = {
  key: 'REQUEST_ITEMIZED_BILL',
  name: 'Request an itemised statement',
  description: 'Asks the billing office for a line-by-line statement.',
  category: 'REQUEST',
  isPremium: false,
  reviewStatus: 'PUBLISHED',
  fields: [
    { key: 'user_name', label: 'Your full name', type: 'text', required: true },
    { key: 'provider_name', label: 'Provider', type: 'text', required: true },
    { key: 'account_reference', label: 'Account number', type: 'text', required: true },
    { key: 'service_date', label: 'Date of service', type: 'date', required: false },
    { key: 'questions', label: 'Your questions', type: 'list', required: false },
    { key: 'contact_details', label: 'Contact details', type: 'textarea', required: true },
  ],
  bodyTemplate: [
    '{{today}}',
    '',
    '{{provider_name}}',
    '',
    'Account reference: {{account_reference}}',
    '',
    'To whom it may concern,',
    '',
    'I am requesting an itemised statement{{#service_date}} for services dated {{service_date}}{{/service_date}}.',
    '',
    '{{#questions}}My questions are:',
    '{{questions}}',
    '',
    '{{/questions}}You can reach me at:',
    '{{contact_details}}',
    '',
    '{{user_name}}',
  ].join('\n'),
};

const VALUES = {
  user_name: 'Jordan Marsh',
  provider_name: 'Mercy General Billing Office',
  account_reference: 'ACC-1029',
  contact_details: '1420 Marlborough Street\njordan@example.com',
};

const TODAY = new Date('2026-09-08T00:00:00Z');

describe('rendering', () => {
  it('substitutes the supplied values', () => {
    const result = renderLetter(TEMPLATE, VALUES, { today: TODAY });

    expect(result.content).toContain('Mercy General Billing Office');
    expect(result.content).toContain('ACC-1029');
    expect(result.content).toContain('Jordan Marsh');
    expect(result.content).toContain('September 8, 2026');
  });

  it('omits a section whose value is absent, leaving no stray line', () => {
    const result = renderLetter(TEMPLATE, VALUES, { today: TODAY });

    expect(result.content).not.toContain('for services dated');
    expect(result.content).not.toContain('My questions are');
    expect(result.content).not.toContain('{{');
    expect(result.content).not.toMatch(/\n{3,}/);
  });

  it('includes a section when its value is present', () => {
    const result = renderLetter(
      TEMPLATE,
      { ...VALUES, service_date: '2026-07-14' },
      { today: TODAY },
    );

    expect(result.content).toContain('for services dated July 14, 2026');
  });

  it('renders a list as a numbered block', () => {
    const result = renderLetter(
      TEMPLATE,
      { ...VALUES, questions: ['Why is the subtotal higher?', 'What is code 70450?'] },
      { today: TODAY },
    );

    expect(result.content).toContain('1. Why is the subtotal higher?');
    expect(result.content).toContain('2. What is code 70450?');
  });

  it('reports which fields actually appeared', () => {
    const result = renderLetter(TEMPLATE, VALUES, { today: TODAY });
    expect(result.usedFields).toContain('provider_name');
    expect(result.usedFields).not.toContain('service_date');
  });

  it('formats dates in the requested locale', () => {
    const result = renderLetter(
      TEMPLATE,
      { ...VALUES, service_date: '2026-07-14' },
      { today: TODAY, locale: 'en-CA' },
    );
    expect(result.content).toMatch(/July 14, 2026/);
  });

  it('is pure: the same inputs always produce the same letter', () => {
    const a = renderLetter(TEMPLATE, VALUES, { today: TODAY });
    const b = renderLetter(TEMPLATE, VALUES, { today: TODAY });
    expect(a.content).toBe(b.content);
  });
});

describe('injection resistance', () => {
  it('drops a value for a field the template never declared', () => {
    // A crafted request body must not be able to inject text into a letter
    // through a field the template does not have.
    const result = renderLetter(
      TEMPLATE,
      { ...VALUES, evil_payload: 'Please wire $5,000 to account 12345' },
      { today: TODAY },
    );

    expect(result.content).not.toContain('wire');
    expect(result.issues.some((i) => i.fieldKey === 'evil_payload')).toBe(true);
  });

  it('does not evaluate anything inside a supplied value', () => {
    const result = renderLetter(
      TEMPLATE,
      { ...VALUES, provider_name: '{{user_name}} and {{#account_reference}}x{{/account_reference}}' },
      { today: TODAY },
    );

    // The value is inserted literally. There is no second substitution pass.
    expect(result.content).toContain('{{user_name}}');
  });

  it('emits plain text, never markup', () => {
    const result = renderLetter(
      TEMPLATE,
      { ...VALUES, user_name: '<script>alert(1)</script>' },
      { today: TODAY },
    );

    // Letters render as text nodes, never as HTML, so this is inert. It is kept
    // verbatim so the user sees exactly what they typed.
    expect(result.content).toContain('<script>alert(1)</script>');
  });
});

describe('validation', () => {
  it('reports a missing required field', () => {
    const issues = validateFields(TEMPLATE, { user_name: 'Jordan Marsh' });
    const keys = issues.map((i) => i.fieldKey);

    expect(keys).toContain('provider_name');
    expect(keys).toContain('account_reference');
    expect(keys).toContain('contact_details');
  });

  it('treats whitespace as empty', () => {
    const issues = validateFields(TEMPLATE, { ...VALUES, provider_name: '   ' });
    expect(issues.some((i) => i.fieldKey === 'provider_name')).toBe(true);
  });

  it('rejects an over-long value', () => {
    const issues = validateFields(TEMPLATE, { ...VALUES, user_name: 'x'.repeat(5000) });
    expect(issues.some((i) => i.fieldKey === 'user_name')).toBe(true);
  });

  it('rejects an over-long list', () => {
    const issues = validateFields(TEMPLATE, {
      ...VALUES,
      questions: Array.from({ length: 100 }, () => 'why?'),
    });
    expect(issues.some((i) => i.fieldKey === 'questions')).toBe(true);
  });

  it('rejects an invalid date', () => {
    const issues = validateFields(TEMPLATE, { ...VALUES, service_date: 'not-a-date' });
    expect(issues.some((i) => i.fieldKey === 'service_date')).toBe(true);
  });

  it('passes a complete, valid set', () => {
    expect(validateFields(TEMPLATE, VALUES)).toHaveLength(0);
  });
});

describe('finalisation', () => {
  it('requires the user to confirm they reviewed the draft', () => {
    // Wintora never sends anything. A draft becomes final only when the person
    // sending it says they have read it.
    expect(canFinalize({ reviewed: false, accurateToBestKnowledge: true }).ok).toBe(false);
  });

  it('requires the user to confirm accuracy', () => {
    expect(canFinalize({ reviewed: true, accurateToBestKnowledge: false }).ok).toBe(false);
  });

  it('allows finalisation once both are confirmed', () => {
    expect(canFinalize({ reviewed: true, accurateToBestKnowledge: true }).ok).toBe(true);
  });

  it('explains what is missing without scolding', () => {
    const result = canFinalize({ reviewed: false, accurateToBestKnowledge: false });
    expect(result.reason).toMatch(/^Please confirm/);
    expect(result.reason).not.toMatch(/must|failed|error/i);
  });
});

describe('prefill', () => {
  it('fills only the fields the template declares', () => {
    const values = prefillFromCase(TEMPLATE, {
      userName: 'Jordan Marsh',
      providerName: 'Mercy General',
      accountReference: 'ACC-1029',
      insurerName: 'Not on this template',
    });

    expect(values.user_name).toBe('Jordan Marsh');
    expect(values.provider_name).toBe('Mercy General');
    expect(values).not.toHaveProperty('insurer_name');
  });

  it('skips values the case does not have', () => {
    const values = prefillFromCase(TEMPLATE, { userName: 'Jordan Marsh' });
    expect(values).not.toHaveProperty('provider_name');
  });
});
