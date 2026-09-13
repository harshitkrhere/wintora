/**
 * The export writers: ZIP, PDF and DOCX, with no library behind them.
 *
 * These tests read the bytes back with independent parsers (Node's zlib for
 * the ZIP container is not needed because entries are stored, so the container
 * is walked by hand; the PDF is checked by its cross-reference table), so a
 * regression in a header shows up as a failed parse rather than a diff.
 */

import { describe, expect, it } from 'vitest';
import { buildZip, crc32 } from '@/domain/export/zip';
import { renderPdf } from '@/domain/export/pdf';
import { renderDocx } from '@/domain/export/docx';
import { normaliseText, type ExportDocument } from '@/domain/export/document';
import { caseSummaryDocument, letterDocument, manifestText, safeFilename } from '@/domain/export/bundle';

const u32 = (b: Uint8Array, at: number): number =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const ascii = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join('');

/** Walk a STORE-only ZIP by its central directory. */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const eocd = bytes.length - 22;
  expect(u32(bytes, eocd)).toBe(0x06054b50);
  const count = u16(bytes, eocd + 10);
  let at = u32(bytes, eocd + 16);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i += 1) {
    expect(u32(bytes, at)).toBe(0x02014b50);
    const method = u16(bytes, at + 10);
    const crc = u32(bytes, at + 16);
    const size = u32(bytes, at + 24);
    const nameLen = u16(bytes, at + 28);
    const local = u32(bytes, at + 42);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    expect(method).toBe(0);
    expect(u32(bytes, local)).toBe(0x04034b50);
    const localNameLen = u16(bytes, local + 26);
    const localExtraLen = u16(bytes, local + 28);
    const dataAt = local + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataAt, dataAt + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    at += 46 + nameLen;
  }
  return out;
}

describe('zip', () => {
  it('round-trips entries with correct CRCs and UTF-8 names', () => {
    const enc = new TextEncoder();
    const zip = buildZip([
      { name: 'README.txt', data: enc.encode('hello') },
      { name: 'letters/01 - Request.pdf', data: new Uint8Array([1, 2, 3, 4, 5]) },
      { name: 'documents/facture-été.pdf', data: new Uint8Array(0) },
    ]);
    const entries = readZip(zip);
    expect([...entries.keys()]).toEqual(['README.txt', 'letters/01 - Request.pdf', 'documents/facture-été.pdf']);
    expect(new TextDecoder().decode(entries.get('README.txt'))).toBe('hello');
    expect(Array.from(entries.get('letters/01 - Request.pdf')!)).toEqual([1, 2, 3, 4, 5]);
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('refuses duplicate names rather than shadowing one', () => {
    const data = new Uint8Array([1]);
    expect(() => buildZip([{ name: 'a', data }, { name: 'a', data }])).toThrow(/duplicate/);
  });
});

const DOC: ExportDocument = {
  title: 'Mercy General — March statement',
  sections: [
    { heading: 'About this case', paragraphs: ['Provider: Mercy General\nAmount: $1,234.56'] },
    { heading: 'Checks', paragraphs: ['1. The line items do not add up (Worth a closer look)', 'Nothing else.'] },
    { pageBreakBefore: true, paragraphs: ['A letter (with parentheses) and a backslash \\ in it.'] },
  ],
};

describe('pdf', () => {
  it('produces a well-formed file with a valid cross-reference table', () => {
    const bytes = renderPdf(DOC);
    const text = ascii(bytes);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);

    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');

    // Every offset in the table points at "N 0 obj".
    const table = /xref\n0 (\d+)\n0000000000 65535 f \n((?:\d{10} 00000 n \n)+)/.exec(text)!;
    const count = Number(table[1]);
    const offsets = table[2]!.trim().split('\n').map((l) => Number(l.slice(0, 10)));
    expect(offsets).toHaveLength(count - 1);
    offsets.forEach((offset, i) => {
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('escapes the characters that would break a string literal', () => {
    const text = ascii(renderPdf(DOC));
    expect(text).toContain('\\(with parentheses\\)');
    expect(text).toContain('backslash \\\\ in it');
  });

  it('uses two pages when a section asks to start on a new one', () => {
    const text = ascii(renderPdf(DOC));
    expect(text).toContain('/Count 2');
  });

  it('declares each stream length in bytes, so readers find the next object', () => {
    const text = ascii(renderPdf(DOC));
    for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) {
      expect(m[2]!.length).toBe(Number(m[1]));
    }
  });

  it('wraps a long paragraph rather than running off the page', () => {
    const long = { title: 'T', sections: [{ paragraphs: [Array(60).fill('word').join(' ')] }] };
    const text = ascii(renderPdf(long));
    const lines = [...text.matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]!);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line.length).toBeLessThan(110);
  });
});

describe('docx', () => {
  it('is a zip with the four parts Word needs and the text inside document.xml', () => {
    const entries = readZip(renderDocx(DOC));
    expect([...entries.keys()].sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml'].sort(),
    );
    const xml = new TextDecoder().decode(entries.get('word/document.xml'));
    expect(xml).toContain('<w:t xml:space="preserve">Provider: Mercy General</w:t>');
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('<w:br w:type="page"/>');
  });

  it('escapes markup in the text', () => {
    const xml = new TextDecoder().decode(
      readZip(renderDocx({ title: 'a < b & "c"', sections: [] })).get('word/document.xml'),
    );
    expect(xml).toContain('a &lt; b &amp; &quot;c&quot;');
  });
});

describe('text normalisation', () => {
  it('replaces typographic characters and drops what Latin-1 cannot show', () => {
    expect(normaliseText('“quotes” – dash — em … é 漢')).toBe('"quotes" - dash -- em ... é ?');
  });
});

describe('bundle documents', () => {
  const now = new Date('2026-09-13T10:00:00Z');

  it('summarises a case with its findings, letters, documents and timeline', () => {
    const doc = caseSummaryDocument(
      {
        title: 'Mercy General',
        providerName: 'Mercy General',
        status: 'OPEN',
        amountCents: 123456,
        currency: 'USD',
        statementDate: '2026-08-30',
        accountReference: 'ACC-1',
        memberLabel: 'Maya',
        notes: null,
        createdAt: '2026-09-01T00:00:00Z',
        analyses: [
          {
            analysisType: 'BILL_CONSISTENCY',
            engineVersion: '1.0.0',
            completedAt: '2026-09-02T00:00:00Z',
            findings: [
              {
                severity: 'ATTENTION',
                title: 'Lines do not add up',
                explanation: 'Sum is off.',
                recommendedAction: 'Ask.',
                confidence: 'HIGH',
                evidence: [{ fieldPath: 'subtotalCents', observed: { subtotal: '$1.00' }, expected: { subtotal: '$2.00' } }],
              },
            ],
          },
        ],
        letters: [{ id: 'l1', title: 'Request', content: 'Hi', status: 'FINALIZED', createdAt: '2026-09-03T00:00:00Z', confirmedAt: '2026-09-04T00:00:00Z' }],
        events: [{ occurredAt: '2026-09-01T00:00:00Z', title: 'Case created', detail: null, origin: 'SYSTEM' }],
        documents: [{ id: 'd1', filename: 'bill.pdf', mimeType: 'application/pdf', byteSize: 10, uploadedAt: '2026-09-01T00:00:00Z' }],
        dates: [{ label: 'Reply by', dueDate: '2026-09-30', verified: false, completed: false }],
      },
      now,
    );
    const all = doc.sections.flatMap((s) => [s.heading ?? '', ...s.paragraphs]).join('\n');
    expect(all).toContain('Amount on the statement: $1,234.56');
    expect(all).toContain('For: Maya');
    expect(all).toContain('1. Lines do not add up (Worth a closer look; confidence high)');
    expect(all).toContain('subtotal: as printed: subtotal $1.00; expected: subtotal $2.00');
    expect(all).toContain('2026-09-30: Reply by (entered by you)');
    expect(all).toContain('bill.pdf - uploaded');
    expect(all).toContain('Case created');
  });

  it('marks an unconfirmed letter as a draft at the top', () => {
    const draft = letterDocument({ id: 'l', title: 'T', content: 'Para one\nline two\n\nPara two', status: 'DRAFT', createdAt: '', confirmedAt: null });
    expect(draft.sections[0]!.paragraphs[0]).toMatch(/^DRAFT/);
    expect(draft.sections[0]!.paragraphs).toHaveLength(3);
    const final = letterDocument({ id: 'l', title: 'T', content: 'Body', status: 'FINALIZED', createdAt: '', confirmedAt: '' });
    expect(final.sections[0]!.paragraphs).toEqual(['Body']);
  });

  it('names files safely and lists what was left out', () => {
    expect(safeFilename('Re: "Mercy" / March <2026>?', 'x')).toBe('Re- -Mercy- - March -2026-');
    expect(safeFilename('漢字', 'fallback')).toBe('fallback');
    const readme = manifestText({ caseTitle: 'C', format: 'pdf', exportedAt: now, files: ['a.pdf'], omitted: ['big.pdf (too large)'] });
    expect(readme).toContain('Not included\n  big.pdf (too large)');
    expect(readme).toContain('has not sent it anywhere');
  });
});
