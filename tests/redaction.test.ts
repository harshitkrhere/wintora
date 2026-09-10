/**
 * Redaction and safe logging.
 *
 * The executable version of the rule in docs/SECURITY.md section 10: a
 * representative sensitive payload must survive neither the AI path nor the
 * logging path with identifiers intact.
 */

import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  containsLikelyIdentifier,
  redact,
  redactObject,
} from '@/domain/redaction/redact';
import { FORBIDDEN_LOG_KEYS, assertLoggable, userRef, ipHash } from '@/lib/logging';

const SAMPLE = [
  'Patient: Jordan Ellery Marsh',
  'DOB: 04/17/1984',
  'SSN: 412-88-7391',
  'Member ID: XQ8837412',
  'Account Number: ACCT-99120345',
  'MRN: 8837120',
  'Email: jordan.marsh@example.com',
  'Phone: (415) 555-0198',
  '1420 Marlborough Street, Suite 300',
  'Postal code: M5V 2T6',
  'Card: 4111 1111 1111 1111',
  'Charge: CT scan of chest, $1,240.00',
].join('\n');

describe('redact', () => {
  const result = redact(SAMPLE, { knownNames: ['Jordan Ellery Marsh'] });

  it('removes every direct identifier from the text', () => {
    expect(result.text).not.toContain('412-88-7391');
    expect(result.text).not.toContain('jordan.marsh@example.com');
    expect(result.text).not.toContain('4111 1111 1111 1111');
    expect(result.text).not.toContain('Jordan');
    expect(result.text).not.toContain('Marsh');
    expect(result.text).not.toContain('XQ8837412');
    expect(result.text).not.toContain('ACCT-99120345');
    expect(result.text).not.toContain('M5V 2T6');
  });

  it('leaves the clinical and financial content that makes analysis possible', () => {
    // The point of placeholders rather than deletion: the document is still
    // analysable, and still anonymous.
    expect(result.text).toContain('CT scan of chest');
    expect(result.text).toContain('1,240.00');
  });

  it('uses stable placeholders so relationships survive', () => {
    const twice = redact('Jordan Marsh paid. Later, Jordan Marsh called.', {
      knownNames: ['Jordan Marsh'],
    });
    const tokens = twice.text.match(/\[NAME_\d+\]/g) ?? [];
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toBe(tokens[1]);
  });

  it('numbers distinct identifiers separately', () => {
    const multi = redact('SSN: 111-22-3333 and SSN: 444-55-6666');
    expect(multi.text).toContain('[SSN_1]');
    expect(multi.text).toContain('[SSN_2]');
  });

  it('keeps the label so the surrounding text still reads sensibly', () => {
    const labelled = redact('Account Number: ACCT-12345');
    expect(labelled.text).toMatch(/Account Number: \[ACCOUNT_NUMBER_1\]/);
  });

  it('reports what categories it found without recording the values', () => {
    expect(result.counts.SSN).toBe(1);
    expect(result.counts.EMAIL).toBe(1);
    expect(Object.values(result.placeholders)).toContain('NAME');
    // The map is placeholder -> category. No original value is retained.
    expect(JSON.stringify(result.placeholders)).not.toContain('412-88-7391');
  });

  it('fails closed on input it cannot process confidently', () => {
    // Failing closed costs a nicer sentence. Failing open costs privacy.
    const huge = redact('x'.repeat(600_000));
    expect(huge.degraded).toBe(true);
    expect(huge.text).toBe('');
  });

  it('does not mangle ordinary clinical text', () => {
    const clinical = redact('Radiology, chest, two views. Quantity 2 at $45.00 each.');
    expect(clinical.text).toContain('Radiology, chest, two views');
  });
});

describe('containsLikelyIdentifier', () => {
  it('detects an identifier that survived', () => {
    expect(containsLikelyIdentifier('SSN 412-88-7391')).toBe(true);
    expect(containsLikelyIdentifier('write to a@b.com')).toBe(true);
    expect(containsLikelyIdentifier('4111111111111111')).toBe(true);
  });

  it('passes clean text', () => {
    expect(containsLikelyIdentifier('CT scan of chest, [NAME_1], $1,240.00')).toBe(false);
  });

  it('confirms the redacted sample is clean', () => {
    const cleaned = redact(SAMPLE, { knownNames: ['Jordan Ellery Marsh'] });
    expect(containsLikelyIdentifier(cleaned.text)).toBe(false);
  });
});

describe('redactObject', () => {
  it('drops keys whose name indicates sensitive content, whatever the value', () => {
    const out = redactObject({
      diagnosis: 'anything at all',
      documentText: 'pages of it',
      password: 'hunter2',
      apiKey: 'sk_live_abc',
      memberId: 'XQ8837412',
      caseId: '11111111-1111-4111-8111-111111111111',
    }) as Record<string, unknown>;

    expect(out.diagnosis).toBe(REDACTED);
    expect(out.documentText).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.memberId).toBe(REDACTED);
    // A case id is an opaque reference, which is exactly what SHOULD be logged.
    expect(out.caseId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('redacts identifiers found inside otherwise harmless strings', () => {
    const out = redactObject({ note: 'call 415-555-0198' }) as Record<string, string>;
    expect(out.note).not.toContain('415-555-0198');
  });

  it('recurses into nested structures and caps depth', () => {
    const out = redactObject({ a: { b: { c: { ssn: '412-88-7391' } } } }) as never;
    expect(JSON.stringify(out)).not.toContain('412-88-7391');

    let deep: unknown = 'ssn 412-88-7391';
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redactObject(deep))).not.toContain('412-88-7391');
  });

  it('handles arrays without exploding on size', () => {
    const out = redactObject(Array.from({ length: 200 }, () => 'a@b.com')) as string[];
    expect(out).toHaveLength(50);
    expect(out.every((v) => !v.includes('a@b.com'))).toBe(true);
  });
});

describe('logging', () => {
  it('refuses payloads carrying forbidden keys', () => {
    const bad = assertLoggable({ documentText: 'x', requestId: 'req_1' });
    expect(bad.ok).toBe(false);
    expect(bad.offending).toContain('documentText');
  });

  it('accepts a well-shaped operational record', () => {
    const good = assertLoggable({
      requestId: 'req_1',
      route: '/api/analyses',
      method: 'POST',
      status: 201,
      latencyMs: 42,
      entitlementReason: 'ALLOWED',
    });
    expect(good.ok).toBe(true);
  });

  it('forbids the raw user id and email', () => {
    // Logs must not become a list of who uses a medical-billing service.
    expect(FORBIDDEN_LOG_KEYS).toContain('userId');
    expect(FORBIDDEN_LOG_KEYS).toContain('email');
  });

  it('produces a stable opaque user reference rather than the id', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const ref = userRef(id);

    expect(ref).toBe(userRef(id));
    expect(ref).not.toContain(id);
    expect(ref).toHaveLength(16);
    expect(userRef('22222222-2222-4222-8222-222222222222')).not.toBe(ref);
  });

  it('hashes IP addresses with a rotating salt', () => {
    const a = ipHash('203.0.113.5', 'salt-window-1');
    const b = ipHash('203.0.113.5', 'salt-window-2');

    expect(a).not.toContain('203.0.113.5');
    // A new salt window breaks linkability once the abuse window has passed.
    expect(a).not.toBe(b);
  });
});
