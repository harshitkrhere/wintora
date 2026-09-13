'use client';

/**
 * Every document across every case, as cards, with a switch for the kind.
 * A document opens its sheet; a letter opens its page. The rows arrived
 * from the server already scoped to this person, and the switch only
 * chooses among them.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { DocumentListItem, LetterListItem } from '@/lib/documents/list';
import { documentTypeLabel, isBillType } from '@/domain/documents/types';
import { Segmented, segmentedIds } from './Segmented';
import { DocumentSheet, type SheetDocument } from './DocumentSheet';
import { EmptyState } from './EmptyState';
import { Icon } from './Icons';
import { fileSummary, letterStatus, readLabel, readTone, shortDate } from './documentStatus';

type Group = 'ALL' | 'BILLS' | 'EOBS' | 'LETTERS';

const GROUPS: readonly { value: Group; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'BILLS', label: 'Bills' },
  { value: 'EOBS', label: 'EOBs' },
  { value: 'LETTERS', label: 'Letters' },
];

function inGroup(group: Group, type: string): boolean {
  if (group === 'ALL') return true;
  if (group === 'BILLS') return isBillType(type);
  if (group === 'EOBS') return type === 'EOB';
  return false;
}

export function DocumentsScreen({
  documents,
  letters,
}: {
  documents: readonly DocumentListItem[];
  letters: readonly LetterListItem[];
}): React.ReactElement {
  const [group, setGroup] = useState<Group>('ALL');
  const [selected, setSelected] = useState<SheetDocument | null>(null);
  const base = 'documents';

  const shownDocuments = group === 'LETTERS' ? [] : documents.filter((d) => inGroup(group, d.documentType));
  const shownLetters = group === 'ALL' || group === 'LETTERS' ? letters : [];
  const nothingAtAll = documents.length === 0 && letters.length === 0;

  if (nothingAtAll) {
    return (
      <EmptyState
        title="Nothing here yet"
        body="Every bill, EOB and letter you review is kept here, on its case, for as long as your plan keeps it."
        action={{ href: '/upload?type=BILL', label: 'Review a bill' }}
      />
    );
  }

  const ids = segmentedIds(base, group);

  return (
    <div className="stack">
      <Segmented label="Kind of document" options={GROUPS} value={group} onChange={setGroup} idBase={base} />
      <div id={ids.panel} role="tabpanel" aria-labelledby={ids.tab} className="stack">
        {shownDocuments.length === 0 && shownLetters.length === 0 ? (
          <p className="muted">Nothing of that kind yet.</p>
        ) : null}
        {shownDocuments.length > 0 ? (
          <div className="doc-list">
            {shownDocuments.map((d) => (
              <button
                key={d.id}
                type="button"
                className="doc-card"
                onClick={() => setSelected({ ...d, scanStatus: 'CLEAN' })}
                aria-haspopup="dialog"
              >
                <Icon name="document" className="doc-card__icon" />
                <span className="doc-card__body">
                  <span className="doc-card__name">{d.filename ?? 'Document'}</span>
                  <span className="doc-card__meta">
                    {documentTypeLabel(d.documentType)} · {fileSummary(d.mimeType, d.pageCount)} · {d.caseTitle}
                  </span>
                </span>
                <span className="doc-card__end">
                  <span className={`badge ${readTone(d.extractionStatus)}`}>{readLabel(d.extractionStatus)}</span>
                  <Icon name="chevron-right" className="row-link__chevron" />
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {shownLetters.length > 0 ? (
          <div className="doc-list">
            {shownLetters.map((l) => {
              const status = letterStatus(l.status, l.sentAt);
              return (
                <Link key={l.id} href={`/cases/${l.caseId}/letters/${l.id}`} className="doc-card">
                  <Icon name="mail" className="doc-card__icon" />
                  <span className="doc-card__body">
                    <span className="doc-card__name">{l.title}</span>
                    <span className="doc-card__meta">
                      Letter · {shortDate(l.updatedAt)} · {l.caseTitle}
                    </span>
                  </span>
                  <span className="doc-card__end">
                    <span className={`badge ${status.tone}`}>{status.label}</span>
                    <Icon name="chevron-right" className="row-link__chevron" />
                  </span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
      <DocumentSheet document={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
