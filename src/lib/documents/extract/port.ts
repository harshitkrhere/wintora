/**
 * The document reader port.
 *
 * One implementation per way of turning bytes into a draft. The orchestrator in
 * ./index.ts picks by file type and configuration; nothing above it knows which
 * reader ran, and swapping one is a config change.
 */

import type { ExtractionDraft } from '@/domain/documents/draft';
import type { AllowedMimeType } from '@/domain/documents/inspect';

export interface ReaderInput {
  readonly bytes: Uint8Array;
  readonly mimeType: AllowedMimeType;
}

export interface DocumentReader {
  readonly name: string;
  readonly version: string;
  /** Can this reader handle this file at all? Cheap, no I/O. */
  accepts(mimeType: AllowedMimeType): boolean;
  read(input: ReaderInput): Promise<ExtractionDraft>;
}
