'use client';

/**
 * Review: the app's one creating action. "What are you dealing with?" and
 * three ways in, each a row a thumb can hit. The row is a link to the
 * upload screen with the kind preselected; the sheet closes as the route
 * changes.
 */

import Link from 'next/link';
import { INTAKE_TYPES, type IntakeKey } from '@/domain/documents/intake';
import { BottomSheet } from './BottomSheet';
import { Icon, type IconName } from './Icons';

const ICON: Record<IntakeKey, IconName> = { BILL: 'receipt', EOB: 'shield', OTHER: 'document' };

export function ReviewSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  return (
    <BottomSheet open={open} onClose={onClose} title="Review a document" description="What are you dealing with?">
      <div className="row-list">
        {INTAKE_TYPES.map((type) => (
          <Link key={type.key} href={`/upload?type=${type.key}`} className="row-link" onClick={onClose}>
            <Icon name={ICON[type.key]} className="row-link__icon" />
            <span className="row-link__text">
              {type.label}
              <span className="row-link__sub">{type.hint}</span>
            </span>
            <Icon name="chevron-right" className="row-link__chevron" />
          </Link>
        ))}
      </div>
    </BottomSheet>
  );
}
