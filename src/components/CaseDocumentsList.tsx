'use client';

/**
 * The documents on one case, as cards. A kept one opens its sheet, where
 * the one thing to do with it is offered (checking its figures, when that
 * is the case's next step); a refused, failed or unfinished upload is
 * shown with its status and is not counted anywhere.
 */

import { useState } from 'react';
import type { CaseDocument } from '@/lib/cases/load';
import { documentTypeLabel } from '@/domain/documents/types';
import { DocumentSheet, type SheetDocument } from './DocumentSheet';
import { Icon } from './Icons';
import { fileSummary, readLabel, readTone, scanLabel, scanTone } from './documentStatus';

export function CaseDocumentsList({
  caseId,
  caseTitle,
  documents,
  checkHref,
  checkDocumentId,
}: {
  caseId: string;
  caseTitle: string;
  documents: readonly CaseDocument[];
  /** Where checking the figures happens, when that is the next step. */
  checkHref: string | null;
  checkDocumentId: string | null;
}): React.ReactElement {
  const [selected, setSelected] = useState<SheetDocument | null>(null);
  return (
    <>
      <div className="doc-list">
        {documents.map((d) => {
          const kept = d.scanStatus === 'CLEAN';
          const body = (
            <>
              <Icon name="document" className="doc-card__icon" />
              <span className="doc-card__body">
                <span className="doc-card__name">{d.filename ?? 'Document'}</span>
                <span className="doc-card__meta">
                  {documentTypeLabel(d.documentType)} · {fileSummary(d.mimeType, d.pageCount)}
                  {!kept ? ' · not counted' : ''}
                </span>
              </span>
              <span className="doc-card__end">
                <span className={`badge ${kept ? readTone(d.extractionStatus) : scanTone(d.scanStatus)}`}>
                  {kept ? readLabel(d.extractionStatus) : scanLabel(d.scanStatus)}
                </span>
                {kept ? <Icon name="chevron-right" className="row-link__chevron" /> : null}
              </span>
            </>
          );
          return kept ? (
            <button
              key={d.id}
              type="button"
              className="doc-card"
              aria-haspopup="dialog"
              onClick={() => setSelected({ ...d, caseId, caseTitle })}
            >
              {body}
            </button>
          ) : (
            <div key={d.id} className="doc-card doc-card--static">
              {body}
            </div>
          );
        })}
      </div>
      <DocumentSheet
        document={selected}
        onClose={() => setSelected(null)}
        action={
          selected !== null && checkHref !== null && selected.id === checkDocumentId
            ? { href: checkHref, label: 'Check the figures' }
            : { href: `/cases/${caseId}`, label: 'Back to the case' }
        }
      />
    </>
  );
}
