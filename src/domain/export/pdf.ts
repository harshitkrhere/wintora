/**
 * A text PDF writer.
 *
 * Letters and case summaries are paragraphs of text. That needs about a
 * hundredth of what a PDF library does, so this writes the file directly:
 * one catalog, one page tree, two standard Type 1 fonts (which every reader
 * has built in, so nothing is embedded), and one content stream per page.
 * Lines are wrapped with the real Helvetica glyph widths, so a line never runs
 * off the page.
 *
 * Pure module: no I/O.
 */

import { normaliseText, type ExportDocument } from './document';

const PAGE_WIDTH = 612; // US Letter, in points. A4 is 595; Letter suits US/CA.
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const BODY_SIZE = 11;
const BODY_LEADING = 15;
const HEADING_SIZE = 14;
const HEADING_LEADING = 20;
const TITLE_SIZE = 18;
const TITLE_LEADING = 26;
const PARAGRAPH_GAP = 8;

/** Helvetica advance widths for ASCII 32..126, in 1/1000 em (Adobe AFM). */
const HELVETICA_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function glyphWidth(code: number): number {
  if (code >= 32 && code <= 126) return HELVETICA_WIDTHS[code - 32]!;
  // Accented Latin-1 letters are about as wide as their base letter; 556 is
  // the width of most lowercase letters and a safe upper-ish estimate.
  return 556;
}

function textWidth(text: string, size: number): number {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) total += glyphWidth(text.charCodeAt(i));
  return (total * size) / 1000;
}

/** Greedy word wrap by measured width. A single over-long word is split. */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const hard of text.split('\n')) {
    const words = hard.split(/ +/);
    let line = '';
    for (const word of words) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (textWidth(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line.length > 0) lines.push(line);
      // The word alone is too wide: break it by characters.
      let piece = '';
      for (const ch of word) {
        if (textWidth(piece + ch, size) > maxWidth && piece.length > 0) {
          lines.push(piece);
          piece = '';
        }
        piece += ch;
      }
      line = piece;
    }
    lines.push(line);
  }
  return lines;
}

/** PDF string literal, WinAnsi bytes with the three specials escaped. */
function pdfString(text: string): string {
  let out = '(';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i) & 0xff;
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

interface Op {
  readonly font: 'F1' | 'F2';
  readonly size: number;
  readonly leading: number;
  readonly text: string;
  /** Extra space before this line. */
  readonly gapBefore: number;
}

/** Lay the document out as a flat list of lines, then cut it into pages. */
function layout(doc: ExportDocument): Op[][] {
  const ops: (Op | 'PAGE_BREAK')[] = [];
  const push = (font: Op['font'], size: number, leading: number, text: string, gapBefore: number): void => {
    for (const line of wrap(normaliseText(text), size, TEXT_WIDTH)) {
      ops.push({ font, size, leading, text: line, gapBefore });
      gapBefore = 0;
    }
  };

  push('F2', TITLE_SIZE, TITLE_LEADING, doc.title, 0);

  doc.sections.forEach((section, index) => {
    if (section.pageBreakBefore === true && index > 0) ops.push('PAGE_BREAK');
    if (section.heading !== undefined && section.heading.length > 0) {
      push('F2', HEADING_SIZE, HEADING_LEADING, section.heading, PARAGRAPH_GAP * 2);
    }
    for (const paragraph of section.paragraphs) {
      if (paragraph.trim().length === 0) {
        ops.push({ font: 'F1', size: BODY_SIZE, leading: BODY_LEADING, text: '', gapBefore: 0 });
        continue;
      }
      push('F1', BODY_SIZE, BODY_LEADING, paragraph, PARAGRAPH_GAP);
    }
  });

  const pages: Op[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  for (const op of ops) {
    if (op === 'PAGE_BREAK') {
      if (pages[pages.length - 1]!.length > 0) {
        pages.push([]);
        y = PAGE_HEIGHT - MARGIN;
      }
      continue;
    }
    const needed = op.gapBefore + op.leading;
    if (y - needed < MARGIN && pages[pages.length - 1]!.length > 0) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN;
      // A gap at the top of a page is wasted space.
      pages[pages.length - 1]!.push({ ...op, gapBefore: 0 });
      y -= op.leading;
      continue;
    }
    pages[pages.length - 1]!.push(op);
    y -= needed;
  }
  return pages;
}

function contentStream(page: readonly Op[]): string {
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;
  let font: string | null = null;
  parts.push(`${MARGIN} ${y} Td`);
  for (const op of page) {
    const dy = op.gapBefore + op.leading;
    y -= dy;
    const key = `${op.font} ${op.size}`;
    if (key !== font) {
      parts.push(`/${op.font} ${op.size} Tf`);
      font = key;
    }
    parts.push(`0 ${-dy} Td`);
    if (op.text.length > 0) parts.push(`${pdfString(op.text)} Tj`);
  }
  parts.push('ET');
  return parts.join('\n');
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** The finished file. */
export function renderPdf(doc: ExportDocument): Uint8Array {
  const pages = layout(doc);
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add(''); // filled once the page tree id is known
  const pageTree = add('');
  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageIds: number[] = [];
  for (const page of pages) {
    const stream = contentStream(page);
    const contentId = add(`<< /Length ${latin1(stream).length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const info = add(`<< /Title ${pdfString(normaliseText(doc.title))} /Producer (Wintora) >>`);

  // The second line is the conventional four high bytes that mark the file as
  // binary to tools that sniff for text.
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(latin1(out).length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = latin1(out).length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1(out);
}
