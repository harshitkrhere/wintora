/**
 * Choose a reader and run it.
 *
 * Order of preference:
 *
 *   PDF with a text layer  -> pdf-text (in-process, free, nothing leaves)
 *   PDF without one        -> Azure, if configured
 *   image                  -> Azure, if configured
 *   anything else          -> an empty draft with a plain note
 *
 * "Not configured" is a normal state, not an error: the customer gets an empty
 * form and a sentence saying why, and can type the figures in. The product
 * must work without any reader, because the reader is not what finds the
 * problems.
 */

import { type ExtractionDraft, emptyDraft } from '@/domain/documents/draft';
import type { AllowedMimeType } from '@/domain/documents/inspect';
import { serverEnv } from '@/lib/env';
import { log } from '@/lib/logging';
import { createAzureReader } from './azure';
import { NoTextLayerError, pdfTextReader } from './pdf-text';
import type { DocumentReader } from './port';

export function ocrReader(): DocumentReader | null {
  const env = serverEnv();
  if (env.OCR_PROVIDER !== 'azure') return null;
  if (env.AZURE_DI_ENDPOINT === undefined || env.AZURE_DI_KEY === undefined) return null;
  return createAzureReader({ endpoint: env.AZURE_DI_ENDPOINT, apiKey: env.AZURE_DI_KEY });
}

const NO_OCR_NOTE =
  'Photos and scans cannot be read automatically yet, so the figures were not filled in. Enter them from your document.';

export async function readDocument(
  bytes: Uint8Array,
  mimeType: AllowedMimeType,
  options: { ocr?: DocumentReader | null } = {},
): Promise<ExtractionDraft> {
  const ocr = options.ocr === undefined ? ocrReader() : options.ocr;

  if (mimeType === 'application/pdf') {
    try {
      return await pdfTextReader.read({ bytes, mimeType });
    } catch (error) {
      if (!(error instanceof NoTextLayerError)) {
        log.warn('pdf text reader failed', {
          route: 'documents.read',
          errorClass: error instanceof Error ? error.name : 'unknown',
        });
        // A parser failure on a file that passed structural checks is unusual
        // and worth a note, but it is not a reason to lose the upload.
        if (ocr === null) {
          return emptyDraft('pdf-text', pdfTextReader.version, 'The PDF could not be read. Enter the figures from your document.');
        }
      }
      // No text layer: fall through to OCR.
    }
  }

  if (ocr === null) {
    return emptyDraft('none', '0', NO_OCR_NOTE);
  }

  try {
    return await ocr.read({ bytes, mimeType });
  } catch (error) {
    log.warn('ocr reader failed', {
      route: 'documents.read',
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
    return emptyDraft(
      ocr.name,
      ocr.version,
      'Automatic reading was unavailable. Enter the figures from your document.',
    );
  }
}
