/**
 * How a document's state reads to a person, in one place, so the case
 * screen, the Documents screen and the metadata sheet say the same thing.
 */

export const SCAN_LABEL: Record<string, string> = {
  CLEAN: 'Checked',
  PENDING: 'Upload not finished',
  INFECTED: 'Refused',
  FAILED: 'Could not be checked',
  SKIPPED: 'Not checked',
};

export const SCAN_TONE: Record<string, string> = {
  CLEAN: 'badge--success',
  PENDING: 'badge--neutral',
  INFECTED: 'badge--error',
  FAILED: 'badge--warning',
  SKIPPED: 'badge--neutral',
};

export function scanLabel(status: string): string {
  return SCAN_LABEL[status] ?? status;
}

export function scanTone(status: string): string {
  return SCAN_TONE[status] ?? 'badge--neutral';
}

/** What happened to the figures, for a kept document. */
export function readLabel(extractionStatus: string): string {
  switch (extractionStatus) {
    case 'COMPLETED':
      return 'Figures read';
    case 'FAILED':
      return 'Could not be read';
    case 'RUNNING':
      return 'Being read';
    default:
      return 'Not read yet';
  }
}

export function readTone(extractionStatus: string): string {
  switch (extractionStatus) {
    case 'COMPLETED':
      return 'badge--success';
    case 'FAILED':
      return 'badge--warning';
    default:
      return 'badge--neutral';
  }
}

/** "PDF · 3 pages", from what the row knows. */
export function fileSummary(mimeType: string, pageCount: number | null): string {
  const kind = mimeType.replace('application/', '').replace('image/', '').toUpperCase();
  return pageCount !== null ? `${kind} · ${pageCount} page${pageCount === 1 ? '' : 's'}` : kind;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function letterStatus(status: string, sentAt: string | null): { label: string; tone: string } {
  if (sentAt !== null) return { label: 'Sent', tone: 'badge--success' };
  if (status === 'FINALIZED') return { label: 'Ready to send', tone: 'badge--info' };
  return { label: 'Draft', tone: 'badge--neutral' };
}
