/**
 * The upload screen's URL: /upload?case={uuid}&document={uuid}&type={key}
 *
 * This is the shape only. Whether the case and the document are this
 * person's is decided on the server page afterwards, by the same rules as
 * everything else (user_id, not deleted, and for a document: on that case
 * and kept). Here a value is either well-formed or ignored, and the page is
 * told when something was present but unusable so it can say so in one
 * neutral sentence, the same for a malformed, unknown, foreign or deleted id.
 *
 *   case      gates `document`: a document is only considered with a case.
 *   document  wins over `type`: the stored kind is the kind.
 *   type      one of the intake keys, else the default (a bill).
 */

import { DEFAULT_INTAKE, isIntakeKey, type IntakeKey } from '@/domain/documents/intake';

export interface UploadParams {
  readonly caseId: string | null;
  readonly documentId: string | null;
  readonly type: IntakeKey;
  /** The parameter was there but not a UUID; the page treats it as missing. */
  readonly malformedCase: boolean;
  readonly malformedDocument: boolean;
  /** `?from=checker`: figures typed into the free tool are waiting in this tab. */
  readonly fromChecker: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

export function parseUploadParams(raw: Record<string, string | string[] | undefined>): UploadParams {
  const caseRaw = one(raw.case);
  const caseId = caseRaw !== null && UUID.test(caseRaw) ? caseRaw.toLowerCase() : null;
  const malformedCase = caseRaw !== null && caseRaw.length > 0 && caseId === null;

  const documentRaw = one(raw.document);
  const documentWellFormed = documentRaw !== null && UUID.test(documentRaw);
  // A document without a usable case is ignored, and not reported as
  // malformed: the case is what was wrong.
  const documentId = caseId !== null && documentWellFormed ? documentRaw.toLowerCase() : null;
  const malformedDocument = caseId !== null && documentRaw !== null && documentRaw.length > 0 && !documentWellFormed;

  const typeRaw = one(raw.type);
  const type: IntakeKey = isIntakeKey(typeRaw) ? typeRaw : DEFAULT_INTAKE.key;

  return {
    caseId,
    documentId,
    type,
    malformedCase,
    malformedDocument,
    fromChecker: one(raw.from) === 'checker',
  };
}
