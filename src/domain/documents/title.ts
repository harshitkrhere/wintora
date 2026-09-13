/**
 * A working name for a case from the name of the file that started it.
 *
 * "mercy_general-march.pdf" becomes "mercy general march": good enough to
 * find the case again, and replaced by the provider's name once the bill
 * has been read, if the reader finds one. But most phones and portals name
 * files after nothing: "file_00000000058c81f8…png", "IMG_20260913_104512",
 * "Screenshot_2026-09-13", "scan0001". A case called that tells the person
 * nothing and, being one unbreakable string, used to decide the width of
 * the screen. Those get a plain name with the date instead.
 *
 * Pure module: no I/O.
 */

/** Tokens a camera, a scanner or a download folder puts in front of a number. */
const NOISE = new Set([
  'img', 'image', 'images', 'pxl', 'dsc', 'dcim', 'scan', 'scanned', 'screenshot', 'screen', 'shot',
  'file', 'files', 'photo', 'photos', 'picture', 'pic', 'document', 'documents', 'doc', 'untitled',
  'new', 'capture', 'download', 'downloads', 'attachment', 'copy', 'final', 'pdf', 'jpg', 'jpeg', 'png',
  'whatsapp', 'signal', 'telegram', 'camera', 'cam',
]);

function isMeaningful(token: string): boolean {
  const lower = token.toLowerCase();
  if (NOISE.has(lower)) return false;
  // Digits, or a hex/id-looking run: "20260913", "58c81f88145d68e7cb26af5", "0042".
  if (/^[0-9a-f]+$/i.test(lower) && (/\d/.test(lower) || lower.length >= 8)) return false;
  // Something a person would recognise needs at least three letters.
  return (lower.match(/[a-z]/g) ?? []).length >= 3;
}

export function titleFromFilename(filename: string, now: Date = new Date()): string {
  const stem = filename.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-\s.()[\]]+/g, ' ').trim();
  // Judge the words apart from their numbers: "scan0001" is "scan" and "0001".
  const tokens = stem
    .split(' ')
    .flatMap((t) => t.split(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/i))
    .filter((t) => t.length > 0);
  if (tokens.some(isMeaningful)) return stem.slice(0, 120);
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `Bill · ${day}`;
}
