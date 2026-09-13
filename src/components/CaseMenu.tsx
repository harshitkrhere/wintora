'use client';

/**
 * The More button beside a case's action bar, and the sheet it opens: the
 * quieter things one can do with a case, each a row. Rows that go
 * somewhere are links (the sheet closes as the route changes); the one
 * that acts in place closes the sheet once the change has taken.
 */

import { useState } from 'react';
import Link from 'next/link';
import { BottomSheet } from './BottomSheet';
import { CaseStatusButton } from './CaseStatusButton';
import { Icon } from './Icons';

export function CaseMenu({
  caseId,
  status,
  canLetters,
  canExport,
}: {
  caseId: string;
  status: string;
  canLetters: boolean;
  canExport: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--secondary btn--icon"
        aria-label="More actions"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="more" />
      </button>
      <BottomSheet open={open} onClose={close} title="This case">
        <div className="row-list">
          <Link href={`/upload?case=${caseId}`} className="row-link" onClick={close}>
            <Icon name="upload" className="row-link__icon" />
            <span className="row-link__text">Add a document</span>
            <Icon name="chevron-right" className="row-link__chevron" />
          </Link>
          {canLetters ? (
            <Link href={`/cases/${caseId}/letters/new`} className="row-link" onClick={close}>
              <Icon name="mail" className="row-link__icon" />
              <span className="row-link__text">Write a letter</span>
              <Icon name="chevron-right" className="row-link__chevron" />
            </Link>
          ) : null}
          {canExport ? (
            <Link href={`/cases/${caseId}/documents#export`} className="row-link" onClick={close}>
              <Icon name="external" className="row-link__icon" />
              <span className="row-link__text">Export this case</span>
              <Icon name="chevron-right" className="row-link__chevron" />
            </Link>
          ) : null}
          <CaseStatusButton caseId={caseId} status={status} className="row-link" onDone={close} />
        </div>
      </BottomSheet>
    </>
  );
}
