'use client';

/**
 * What is known about one document, in a sheet: the file, its kind, its
 * pages, whether it was checked and read, when it arrived and how long it
 * is kept. The file itself is not opened here; a reader is a later phase.
 * One action at most: the next thing to do with it, or the case it is on.
 */

import Link from 'next/link';
import { documentTypeLabel } from '@/domain/documents/types';
import { BottomSheet } from './BottomSheet';
import { dateTime, fileSummary, readLabel, scanLabel, shortDate } from './documentStatus';

export interface SheetDocument {
  readonly id: string;
  readonly filename: string | null;
  readonly mimeType: string;
  readonly documentType: string;
  readonly pageCount: number | null;
  readonly scanStatus: string;
  readonly extractionStatus: string;
  readonly retentionUntil: string | null;
  readonly createdAt: string;
  readonly caseId: string;
  readonly caseTitle?: string;
}

export function DocumentSheet({
  document,
  onClose,
  action,
}: {
  document: SheetDocument | null;
  onClose: () => void;
  /** The one thing to do with it. Defaults to opening the case. */
  action?: { href: string; label: string };
}): React.ReactElement {
  const d = document;
  const kept = d !== null && d.scanStatus === 'CLEAN';
  const go = action ?? (d !== null ? { href: `/cases/${d.caseId}`, label: 'Open the case' } : undefined);
  return (
    <BottomSheet
      open={d !== null}
      onClose={onClose}
      title={d?.filename ?? 'Document'}
      description={d?.caseTitle}
      footer={
        go !== undefined ? (
          <Link href={go.href} className="btn btn--primary btn--block" onClick={onClose}>
            {go.label}
          </Link>
        ) : undefined
      }
    >
      {d !== null ? (
        <dl className="fact-list">
          <div>
            <dt>Kind</dt>
            <dd>{documentTypeLabel(d.documentType)}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd>{fileSummary(d.mimeType, d.pageCount)}</dd>
          </div>
          <div>
            <dt>Upload</dt>
            <dd>{scanLabel(d.scanStatus)}</dd>
          </div>
          {kept ? (
            <div>
              <dt>Figures</dt>
              <dd>{readLabel(d.extractionStatus)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Uploaded</dt>
            <dd>{dateTime(d.createdAt)}</dd>
          </div>
          {kept && d.retentionUntil !== null ? (
            <div>
              <dt>Kept until</dt>
              <dd>{shortDate(d.retentionUntil)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </BottomSheet>
  );
}
