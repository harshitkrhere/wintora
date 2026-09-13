/**
 * What a document can be, as the database says it (the document_type enum
 * in supabase/migrations/0001). One list, used by the upload API and by
 * everything that classifies a document, so nothing drifts.
 */

export const DOCUMENT_TYPES = [
  'BILL', 'ITEMIZED_BILL', 'EOB', 'STATEMENT', 'DENIAL_LETTER',
  'CORRESPONDENCE', 'INSURANCE_CARD', 'RECEIPT', 'OTHER',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The kinds the engine reads as a bill: the statement side of a check. */
export const BILL_TYPES: readonly DocumentType[] = ['BILL', 'ITEMIZED_BILL', 'STATEMENT'];

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isBillType(type: string): boolean {
  return (BILL_TYPES as readonly string[]).includes(type);
}

/** How a document's kind reads to a person. */
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  BILL: 'Bill',
  ITEMIZED_BILL: 'Itemized bill',
  EOB: 'EOB',
  STATEMENT: 'Statement',
  DENIAL_LETTER: 'Insurer letter',
  CORRESPONDENCE: 'Correspondence',
  INSURANCE_CARD: 'Insurance card',
  RECEIPT: 'Receipt',
  OTHER: 'Document',
};

export function documentTypeLabel(type: string): string {
  return isDocumentType(type) ? DOCUMENT_TYPE_LABEL[type] : 'Document';
}
