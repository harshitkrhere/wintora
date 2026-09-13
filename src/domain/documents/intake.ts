/**
 * The ways in. Review, the app's one creating action, asks "what are you
 * dealing with?" and offers these three. The engine checks bills and
 * EOBs; anything else is kept with the case and never checked, and the
 * words say so before the file is chosen.
 *
 * Chosen by the owner in September 2026 over a fourth "insurance
 * document" option, which would have promised a check that does not
 * exist. Adding one later is a row here and nothing else.
 */

import type { DocumentType } from './types';

export type IntakeKey = 'BILL' | 'EOB' | 'OTHER';

export interface IntakeType {
  readonly key: IntakeKey;
  /** What it is called in the Review sheet and on the type control. */
  readonly label: string;
  /** One line under the label in the Review sheet. */
  readonly hint: string;
  /** The upload screen's heading once this is chosen. */
  readonly heading: string;
  /** The sentence under that heading: what will happen to the file. */
  readonly support: string;
  /** What is stored on the document. */
  readonly documentType: DocumentType;
}

export const INTAKE_TYPES: readonly IntakeType[] = [
  {
    key: 'BILL',
    label: 'Bill',
    hint: 'From a hospital, clinic, lab or doctor',
    heading: 'Upload your bill',
    support: 'We read the figures and check that they add up.',
    documentType: 'BILL',
  },
  {
    key: 'EOB',
    label: 'EOB',
    hint: 'The explanation of benefits from your insurer',
    heading: 'Upload your EOB',
    support: 'We read the figures so you can compare them with the bill.',
    documentType: 'EOB',
  },
  {
    key: 'OTHER',
    label: 'Something else',
    hint: 'A letter, a receipt, an insurance card',
    heading: 'Upload the document',
    support: 'Kept with the case. Checks run on bills and EOBs.',
    documentType: 'OTHER',
  },
];

export const DEFAULT_INTAKE: IntakeType = INTAKE_TYPES[0]!;

export function isIntakeKey(value: unknown): value is IntakeKey {
  return typeof value === 'string' && INTAKE_TYPES.some((type) => type.key === value);
}

/** The intake for a key from a URL, or the default when it is not one. */
export function intakeFor(key: unknown): IntakeType {
  return INTAKE_TYPES.find((type) => type.key === key) ?? DEFAULT_INTAKE;
}

/** The intake a stored document belongs to, for a screen that resumes it. */
export function intakeForDocumentType(type: string): IntakeType {
  if (type === 'EOB') return intakeFor('EOB');
  if (type === 'BILL' || type === 'ITEMIZED_BILL' || type === 'STATEMENT') return intakeFor('BILL');
  return intakeFor('OTHER');
}
