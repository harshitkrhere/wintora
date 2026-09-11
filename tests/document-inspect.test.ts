/**
 * Byte inspection of uploads.
 *
 * The client-supplied name and type prove nothing. These tests feed bytes and
 * assert verdicts, including the obfuscations an attacker reaches for first.
 */

import { describe, expect, it } from 'vitest';
import { inspectPdf, sniffMimeType, structuralScan } from '@/domain/documents/inspect';

function bytes(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
}

const PDF_HEADER = '%PDF-1.4\n';
const PAGE = '1 0 obj << /Type /Page /Parent 2 0 R >> endobj\n';
const PAD = 'x'.repeat(32);

function pdf(body: string): Uint8Array {
  return bytes(`${PDF_HEADER}${body}${PAD}\n%%EOF`);
}

describe('sniffMimeType', () => {
  it('identifies each allowed type by content', () => {
    expect(sniffMimeType(pdf(PAGE))).toBe('application/pdf');
    expect(sniffMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(16).fill(0)]))).toBe('image/png');
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(16).fill(0)]))).toBe('image/jpeg');
    expect(sniffMimeType(new Uint8Array([0x49, 0x49, 0x2a, 0x00, ...new Array(16).fill(0)]))).toBe('image/tiff');
    const heic = new Uint8Array(24);
    heic.set([0, 0, 0, 0x18], 0);
    heic.set(bytes('ftypheic'), 4);
    expect(sniffMimeType(heic)).toBe('image/heic');
  });

  it('refuses a renamed executable, a script and an office document', () => {
    expect(sniffMimeType(bytes('MZ' + 'x'.repeat(30)))).toBeNull();
    expect(sniffMimeType(bytes('<script>alert(1)</script>' + 'x'.repeat(10)))).toBeNull();
    // ZIP (docx/xlsx are zips) starts PK\x03\x04
    expect(sniffMimeType(bytes('PK\x03\x04' + 'x'.repeat(30)))).toBeNull();
  });

  it('refuses anything shorter than a real file', () => {
    expect(sniffMimeType(bytes('%PDF-'))).toBeNull();
    expect(sniffMimeType(new Uint8Array(0))).toBeNull();
  });
});

describe('inspectPdf', () => {
  it('passes a plain document and counts its pages', () => {
    const r = inspectPdf(pdf(PAGE + PAGE + PAGE));
    expect(r.ok).toBe(true);
    expect(r.pageCount).toBe(3);
  });

  it('does not count the /Pages tree node as a page', () => {
    const r = inspectPdf(pdf('2 0 obj << /Type /Pages /Kids [] >> endobj\n' + PAGE));
    expect(r.pageCount).toBe(1);
  });

  it('rejects JavaScript', () => {
    const r = inspectPdf(pdf(PAGE + '3 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n'));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/JavaScript/);
  });

  // The first thing an attacker tries: hex-escape part of the name so a naive
  // substring check misses it. /J#61vaScript is /JavaScript to a PDF reader.
  it('rejects hex-obfuscated JavaScript', () => {
    const r = inspectPdf(pdf(PAGE + '3 0 obj << /S /J#61vaScript >> endobj\n'));
    expect(r.ok).toBe(false);
  });

  it('rejects launch actions, embedded files, encryption, rich media and XFA', () => {
    for (const token of ['/Launch', '/EmbeddedFile', '/Encrypt', '/RichMedia', '/XFA']) {
      const r = inspectPdf(pdf(PAGE + `3 0 obj << ${token} >> endobj\n`));
      expect(r.ok, token).toBe(false);
    }
  });

  it('allows an open action that merely goes to a page', () => {
    const r = inspectPdf(pdf(PAGE + '/OpenAction [1 0 R /Fit]\n'));
    expect(r.ok).toBe(true);
  });

  it('rejects an open action that reaches outside the document', () => {
    const r = inspectPdf(pdf(PAGE + '/OpenAction << /S /URI /URI (http://evil.example) >>\n'));
    expect(r.ok).toBe(false);
  });
});

describe('structuralScan', () => {
  it('returns CLEAN with a page count for a good PDF', () => {
    const r = structuralScan(pdf(PAGE + PAGE));
    expect(r.verdict).toBe('CLEAN');
    expect(r.mimeType).toBe('application/pdf');
    expect(r.pageCount).toBe(2);
  });

  it('returns INFECTED, not FAILED, for a dangerous PDF', () => {
    const r = structuralScan(pdf(PAGE + '/Launch'));
    expect(r.verdict).toBe('INFECTED');
    expect(r.detail).toMatch(/launch/);
  });

  it('returns INFECTED for a file that is not on the allowlist at all', () => {
    const r = structuralScan(bytes('MZ' + 'x'.repeat(40)));
    expect(r.verdict).toBe('INFECTED');
    expect(r.mimeType).toBeNull();
  });

  it('returns FAILED for an empty file', () => {
    expect(structuralScan(new Uint8Array(0)).verdict).toBe('FAILED');
  });

  // The detail is stored and may be shown to staff. It must never carry
  // document content, only the category of problem.
  it('never puts file content in the detail', () => {
    const r = structuralScan(pdf(PAGE + '/JS (SECRET-PATIENT-NAME)'));
    expect(r.detail).not.toContain('SECRET');
  });
});
