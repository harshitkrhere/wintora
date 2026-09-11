/**
 * The in-process PDF reader, against a real PDF.
 *
 * unpdf wraps a serverless build of pdf.js. Whether it actually runs under
 * Node in this project, with this bundler configuration, is an integration
 * question, and the only way to answer it is to hand it a PDF. This one is
 * built by hand: a valid single-page document with a text layer.
 */

import { describe, expect, it } from 'vitest';
import { NoTextLayerError, pdfTextReader } from '@/lib/documents/extract/pdf-text';
import { structuralScan } from '@/domain/documents/inspect';

function minimalPdf(lines: readonly string[]): Uint8Array {
  const content = ['BT', '/F1 11 Tf', '72 740 Td', '13 TL']
    .concat(lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`))
    .concat(['ET'])
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new Uint8Array([...out].map((c) => c.charCodeAt(0) & 0xff));
}

const BILL_LINES = [
  'MERCY GENERAL HOSPITAL',
  'Statement date: 03/05/2026   Account: 4471-22',
  'ER visit level 3        99283        $840.00',
  'CT head w/o contrast    70450        $400.00',
  'Subtotal                             $1,240.00',
  'Insurance paid                       $0.00',
  'Amount due                           $1,420.00',
  'Please remit payment within 30 days of the statement date.',
  'Questions? Call the billing office during business hours.',
];

describe('pdfTextReader', () => {
  it('passes the structural scan first', () => {
    const scan = structuralScan(minimalPdf(BILL_LINES));
    expect(scan.verdict).toBe('CLEAN');
    expect(scan.mimeType).toBe('application/pdf');
    expect(scan.pageCount).toBe(1);
  });

  it('extracts the text layer and hands it to the structuring step', async () => {
    let received = '';
    const provider = {
      name: 'fake',
      complete: async ({ user }: { user: string }) => {
        received = user;
        return JSON.stringify({ currency: 'USD', amountDue: '$1,420.00', lineItems: [] });
      },
    };

    // Route through structureText with the fake provider by reading text the
    // same way the reader does, then asserting on what reached the model.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(minimalPdf(BILL_LINES));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    expect(totalPages).toBe(1);
    expect(text).toContain('MERCY GENERAL');
    expect(text).toContain('$1,420.00');

    const { structureText } = await import('@/lib/documents/extract/structure');
    const draft = await structureText(text, { engine: 'pdf-text', pageCount: totalPages, provider });
    expect(received).toContain('$840.00');
    expect(draft.amountDue?.amountCents).toBe(142000);
    expect(draft.pageCount).toBe(1);
  });

  it('declines a PDF with no usable text layer so OCR can take it', async () => {
    await expect(
      pdfTextReader.read({ bytes: minimalPdf(['x']), mimeType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(NoTextLayerError);
  });
});
