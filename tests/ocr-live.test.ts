/**
 * Live Azure Document Intelligence smoke test. Opt-in, network, never gated.
 *
 *   npm run ocr:smoke
 *
 * Sends a small synthetic bill (no customer data) through the real adapter:
 * real endpoint, real key, real polling. The mapping is unit-tested against a
 * recorded response; this is the only thing that proves the request side.
 */

import { describe, expect, it } from 'vitest';
import { createAzureReader } from '@/lib/documents/extract/azure';

const LIVE = process.env.OCR_LIVE === '1';

function pdfEscape(s: string): string {
  return s.replace(/[()\\]/g, (m) => `\\${m}`);
}

function minimalPdf(lines: readonly string[]): Uint8Array {
  const content = ['BT', '/F1 11 Tf', '72 740 Td', '14 TL']
    .concat(lines.map((l) => `(${pdfEscape(l)}) Tj T*`))
    .concat(['ET'])
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
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

describe.skipIf(!LIVE)('Azure Document Intelligence live', () => {
  it(
    'reads a synthetic bill end to end',
    async () => {
      const endpoint = process.env.AZURE_DI_ENDPOINT ?? '';
      const apiKey = process.env.AZURE_DI_KEY ?? '';
      expect(endpoint, 'AZURE_DI_ENDPOINT missing').not.toBe('');
      expect(apiKey, 'AZURE_DI_KEY missing').not.toBe('');

      const reader = createAzureReader({ endpoint, apiKey });
      const draft = await reader.read({
        bytes: minimalPdf([
          'MERCY GENERAL HOSPITAL',
          'Invoice: ACCT-4471          Date: 03/05/2026',
          '',
          'Description                Code      Amount',
          'ER visit level 3           99283     $840.00',
          'CT head w/o contrast       70450     $400.00',
          '',
          'Subtotal                             $1,240.00',
          'Total                                $1,420.00',
          'Amount Due                           $1,420.00',
        ]),
        mimeType: 'application/pdf',
      });

      // eslint-disable-next-line no-console
      console.log(
        '\n  engine:', draft.engine,
        '\n  pages:', draft.pageCount,
        '\n  currency:', draft.currency,
        '\n  provider:', draft.providerName?.value ?? '(none)',
        '\n  total:', draft.total?.amountCents ?? '(none)',
        '\n  amountDue:', draft.amountDue?.amountCents ?? '(none)',
        '\n  lineItems:', draft.lineItems.length,
        draft.lineItems
          .map((l) => `\n    - ${l.description} | ${l.code ?? '-'} | ${l.amountCents ?? 'null'} | ${l.confidence}`)
          .join(''),
        '\n  overall:', draft.overallConfidence,
        '\n  notes:', draft.notes.join(' / '),
        '\n',
      );

      expect(draft.engine).toBe('azure-invoice');
      expect(draft.pageCount).toBe(1);
      // The request side is what this proves. Field quality on a synthetic
      // Helvetica PDF is informational, so only the shape is asserted.
      expect(Array.isArray(draft.lineItems)).toBe(true);
    },
    90_000,
  );
});
