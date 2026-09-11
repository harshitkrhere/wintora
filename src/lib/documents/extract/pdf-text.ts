/**
 * PDF text-layer reader.
 *
 * Most bills a customer downloads from a hospital or insurer portal are
 * generated PDFs with a text layer, and for those no OCR is needed: the text
 * is extracted in-process with unpdf (a serverless build of pdf.js), never
 * leaving our own function, and the configured model lays the figures out.
 *
 * A scanned PDF (a photo saved as PDF) has no text layer. This reader detects
 * that by text density and declines, so the orchestrator can hand it to an
 * OCR reader instead of producing an empty draft.
 *
 * Runs only AFTER the structural scan has passed. pdf.js is a full parser and
 * therefore the attack surface those checks exist to protect.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import type { ExtractionDraft } from '@/domain/documents/draft';
import type { DocumentReader, ReaderInput } from './port';
import { structureText } from './structure';

/**
 * Below this many characters per page the "text layer" is almost certainly
 * a few stray glyphs on a scan, not a bill. Real bills run 800–3000.
 */
const MIN_CHARS_PER_PAGE = 120;

export class NoTextLayerError extends Error {
  constructor(readonly charsPerPage: number) {
    super(`PDF has no usable text layer (${charsPerPage} chars/page)`);
    this.name = 'NoTextLayerError';
  }
}

export const pdfTextReader: DocumentReader = {
  name: 'pdf-text',
  version: '1',

  accepts(mimeType): boolean {
    return mimeType === 'application/pdf';
  },

  async read(input: ReaderInput): Promise<ExtractionDraft> {
    const pdf = await getDocumentProxy(input.bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });

    const pages = Math.max(1, totalPages);
    const charsPerPage = Math.round(text.trim().length / pages);
    if (charsPerPage < MIN_CHARS_PER_PAGE) {
      throw new NoTextLayerError(charsPerPage);
    }

    return structureText(text, { engine: 'pdf-text', pageCount: pages });
  },
};
