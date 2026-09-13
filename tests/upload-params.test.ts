/**
 * The upload URL: what is honoured, what is ignored, what wins.
 */

import { describe, expect, it } from 'vitest';
import { parseUploadParams } from '@/lib/documents/upload-params';

const CASE = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';

describe('parseUploadParams', () => {
  it('defaults to a bill with no case and no document', () => {
    expect(parseUploadParams({})).toEqual({
      caseId: null,
      documentId: null,
      type: 'BILL',
      malformedCase: false,
      malformedDocument: false,
      fromChecker: false,
    });
  });

  it('accepts a well-formed case id and lower-cases it', () => {
    expect(parseUploadParams({ case: CASE.toUpperCase() }).caseId).toBe(CASE);
  });

  it('ignores a malformed case id and says so', () => {
    for (const bad of ['abc', '1234', `${CASE}x`, "' or 1=1 --", '../etc']) {
      const parsed = parseUploadParams({ case: bad });
      expect(parsed.caseId, bad).toBeNull();
      expect(parsed.malformedCase, bad).toBe(true);
    }
  });

  it('does not report an empty case parameter as malformed', () => {
    expect(parseUploadParams({ case: '' }).malformedCase).toBe(false);
  });

  it('only considers a document when the case is usable', () => {
    expect(parseUploadParams({ document: DOC }).documentId).toBeNull();
    expect(parseUploadParams({ document: DOC }).malformedDocument).toBe(false);
    expect(parseUploadParams({ case: 'nope', document: DOC }).documentId).toBeNull();
    expect(parseUploadParams({ case: CASE, document: DOC }).documentId).toBe(DOC);
  });

  it('ignores a malformed document id and says so, given a usable case', () => {
    const parsed = parseUploadParams({ case: CASE, document: 'nope' });
    expect(parsed.documentId).toBeNull();
    expect(parsed.malformedDocument).toBe(true);
  });

  it('honours the intake keys and nothing else', () => {
    expect(parseUploadParams({ type: 'EOB' }).type).toBe('EOB');
    expect(parseUploadParams({ type: 'OTHER' }).type).toBe('OTHER');
    for (const bad of ['eob', 'CORRESPONDENCE', 'INSURANCE_CARD', 'x', '']) {
      expect(parseUploadParams({ type: bad }).type, bad).toBe('BILL');
    }
  });

  it('takes the first value when a parameter repeats', () => {
    expect(parseUploadParams({ type: ['EOB', 'OTHER'] }).type).toBe('EOB');
    expect(parseUploadParams({ case: [CASE, DOC] }).caseId).toBe(CASE);
  });

  it('carries the checker hand-off flag', () => {
    expect(parseUploadParams({ from: 'checker' }).fromChecker).toBe(true);
    expect(parseUploadParams({ from: 'elsewhere' }).fromChecker).toBe(false);
  });

  it('ignores unknown parameters', () => {
    expect(parseUploadParams({ next: '/x', utm: 'y' }).caseId).toBeNull();
  });
});
