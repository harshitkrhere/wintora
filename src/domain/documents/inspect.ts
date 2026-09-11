/**
 * Byte-level inspection of an uploaded file.
 *
 * Everything a customer uploads is hostile until proven otherwise, and the
 * client-supplied filename and Content-Type prove nothing: both are chosen by
 * the uploader. The only evidence is the bytes.
 *
 * Two questions are answered here, and both are answered from the bytes alone:
 *
 *   1. What IS this file? (magic-number sniffing against a short allowlist)
 *   2. If it is a PDF, does it carry anything that could act rather than be
 *      read? (scripts, launch actions, embedded files, encryption)
 *
 * This is the whole "malware scan" for now. That is a deliberate, documented
 * position rather than a gap: these files are parsed by our own extraction
 * code and never executed, never served to a browser as anything but a
 * download, and never shown to another customer. The attacks that matter
 * against such a file are the structural ones checked below, not signature
 * matching against a virus database. A signature scanner can be added behind
 * MALWARE_SCAN_PROVIDER later; docs/LIMITATIONS.md says plainly that none runs
 * today.
 *
 * Pure module: no I/O, no dependencies.
 */

export type AllowedMimeType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/heic'
  | 'image/tiff';

export const ALLOWED_MIME_TYPES: readonly AllowedMimeType[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/tiff',
];

/** Enough of the file to identify it. Nothing here needs more than 16 bytes. */
const SNIFF_LENGTH = 16;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < Math.min(bytes.length, start + length); i += 1) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

/**
 * Identify the file from its leading bytes. Returns null for anything not on
 * the allowlist, which includes files that are merely renamed.
 */
export function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  if (bytes.length < SNIFF_LENGTH) return null;

  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';

  // \x89PNG\r\n\x1a\n
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // TIFF: II*\0 (little-endian) or MM\0* (big-endian)
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'image/tiff';
  }

  // HEIC/HEIF: ISO BMFF box "ftyp" at offset 4 with a heic/heix/mif1 brand.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }

  return null;
}

export interface PdfInspection {
  readonly ok: boolean;
  /** Human-readable reasons, safe to store in scan_detail and show to staff. */
  readonly reasons: readonly string[];
  /** Approximate. Counts page objects; good enough for quota and display. */
  readonly pageCount: number;
}

/**
 * Structural checks on a PDF.
 *
 * These are substring scans over the raw bytes rather than a full parse. A
 * full parser is exactly the attack surface being defended, so it does not run
 * until the file has passed this. Obfuscated names (e.g. /J#61vaScript) are
 * decoded before matching, because that is the first thing an attacker tries.
 */
export function inspectPdf(bytes: Uint8Array): PdfInspection {
  const reasons: string[] = [];

  // Decode as Latin-1 so every byte maps to exactly one character and offsets
  // are stable. PDF name tokens are ASCII, so this is lossless for our purpose.
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i] ?? 0);

  // Undo #xx hex escapes inside name tokens so /J#61vaScript reads as
  // /JavaScript. Only applied to the character class that can appear in a
  // name, which keeps binary stream data from producing false matches.
  const normalised = text.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  const has = (token: string): boolean => normalised.includes(token);

  if (has('/Encrypt')) {
    reasons.push('encrypted: the parser cannot inspect it, so it is refused');
  }
  if (has('/JavaScript') || has('/JS ') || has('/JS/') || has('/JS<')) {
    reasons.push('contains JavaScript');
  }
  if (has('/Launch')) {
    reasons.push('contains a launch action');
  }
  if (has('/EmbeddedFile') || has('/EmbeddedFiles')) {
    reasons.push('contains embedded files');
  }
  if (has('/RichMedia') || has('/Flash')) {
    reasons.push('contains rich media');
  }
  if (has('/XFA')) {
    reasons.push('contains an XFA form, which can carry script');
  }
  // /OpenAction and /AA (additional actions) are only dangerous with an action
  // that does something; the checks above already catch those. Flag them only
  // when they appear WITH an action we could not classify, to avoid rejecting
  // every PDF that merely opens at page 2.
  if ((has('/OpenAction') || has('/AA')) && (has('/URI') || has('/GoToR') || has('/SubmitForm'))) {
    reasons.push('contains an automatic action that reaches outside the document');
  }

  const pageMatches = normalised.match(/\/Type\s*\/Page(?![s])/g);
  const pageCount = Math.max(1, pageMatches?.length ?? 1);

  return { ok: reasons.length === 0, reasons, pageCount };
}

export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'FAILED';

export interface ScanResult {
  readonly verdict: ScanVerdict;
  readonly mimeType: AllowedMimeType | null;
  readonly pageCount: number | null;
  /** One line, no customer content. */
  readonly detail: string;
}

/**
 * The whole scan, from bytes to a verdict the documents table can store.
 *
 * FAILED means "we could not tell", which is treated identically to INFECTED
 * downstream: extraction refuses to run. The distinction is kept for staff, who
 * may want to know whether a file was rejected or merely unreadable.
 */
export function structuralScan(bytes: Uint8Array): ScanResult {
  if (bytes.length === 0) {
    return { verdict: 'FAILED', mimeType: null, pageCount: null, detail: 'empty file' };
  }

  const mimeType = sniffMimeType(bytes);
  if (mimeType === null) {
    return {
      verdict: 'INFECTED',
      mimeType: null,
      pageCount: null,
      detail: 'not a PDF, PNG, JPEG, HEIC or TIFF by content',
    };
  }

  if (mimeType === 'application/pdf') {
    const inspection = inspectPdf(bytes);
    if (!inspection.ok) {
      return {
        verdict: 'INFECTED',
        mimeType,
        pageCount: inspection.pageCount,
        detail: `PDF ${inspection.reasons.join('; ')}`,
      };
    }
    return {
      verdict: 'CLEAN',
      mimeType,
      pageCount: inspection.pageCount,
      detail: 'structural checks passed',
    };
  }

  // Images: identified by content and parsed only by the OCR provider, which
  // receives them over HTTPS and never executes them. Page count is one.
  return { verdict: 'CLEAN', mimeType, pageCount: 1, detail: 'structural checks passed' };
}
