/**
 * The working name of a case from its first file: a name a person gave it
 * survives; a name a camera, a scanner or a download folder gave it does not.
 */

import { describe, expect, it } from 'vitest';
import { titleFromFilename } from '@/domain/documents/title';

const NOW = new Date('2026-09-13T10:23:00Z');

describe('titleFromFilename', () => {
  it('keeps a name a person gave the file', () => {
    expect(titleFromFilename('mercy_general-march.pdf', NOW)).toBe('mercy general march');
    expect(titleFromFilename('Riverside statement (final).PDF', NOW)).toBe('Riverside statement final');
    expect(titleFromFilename('ER visit June.jpeg', NOW)).toBe('ER visit June');
  });

  it('replaces a name nobody chose with the date', () => {
    for (const name of [
      'file_00000000058c81f88145d68e7cb26af5.png',
      'IMG_20260913_104512.jpg',
      'PXL_20260913_101010.jpg',
      'DSC_0042.JPG',
      'Screenshot_2026-09-13-10-45-12.png',
      'scan0001.pdf',
      'document.pdf',
      '20260913_104512.jpg',
      'Untitled.pdf',
      'WhatsApp Image 2026-09-13 at 10.23.45.jpeg',
      'image (3).png',
      'download.pdf',
      '.pdf',
    ]) {
      expect(titleFromFilename(name, NOW), name).toBe('Bill · Sep 13, 2026');
    }
  });

  it('keeps a real word even beside a camera number', () => {
    expect(titleFromFilename('IMG_2041 dentist.jpg', NOW)).toBe('IMG 2041 dentist');
  });

  it('never exceeds 120 characters', () => {
    expect(titleFromFilename(`${'statement '.repeat(30)}.pdf`, NOW).length).toBeLessThanOrEqual(120);
  });
});
