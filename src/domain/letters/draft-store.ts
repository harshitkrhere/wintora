/**
 * A letter's form, kept in the browser while it is being filled in, so a
 * dropped connection or a closed tab does not lose what was typed.
 *
 * Only what the person typed is kept, never document text or figures the
 * server produced. A draft is restored only for a template the page still
 * offers, and only within thirty days; anything else is discarded on
 * sight. Every access tolerates a storage that refuses (private windows,
 * cleared site data, a browser that throws on the property itself).
 */

import type { StorageLike } from '@/domain/checker/handoff';

export interface StoredLetterDraft {
  readonly values: Readonly<Record<string, string>>;
  readonly docIds: readonly string[];
  readonly findingIds: readonly string[];
}

interface Envelope extends StoredLetterDraft {
  readonly version: 1;
  readonly savedAt: string;
}

export const LETTER_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function letterDraftKey(caseId: string, templateKey: string): string {
  return `wintora:letter-draft:${caseId}:${templateKey}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function readLetterDraft(
  storage: StorageLike | null,
  caseId: string,
  templateKey: string,
  offeredTemplateKeys: readonly string[],
  now: Date,
): StoredLetterDraft | null {
  if (storage === null) return null;
  const key = letterDraftKey(caseId, templateKey);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const discard = (): null => {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing to do; it will be ignored next time as well.
    }
    return null;
  };

  if (!offeredTemplateKeys.includes(templateKey)) return discard();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return discard();
  }
  if (parsed === null || typeof parsed !== 'object') return discard();
  const env = parsed as Partial<Envelope>;
  if (env.version !== 1 || typeof env.savedAt !== 'string') return discard();
  const age = now.getTime() - Date.parse(env.savedAt);
  if (!Number.isFinite(age) || age < 0 || age > LETTER_DRAFT_TTL_MS) return discard();
  if (env.values === null || typeof env.values !== 'object') return discard();

  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(env.values as Record<string, unknown>)) {
    if (typeof v === 'string') values[k] = v;
  }
  return {
    values,
    docIds: isStringArray(env.docIds) ? env.docIds : [],
    findingIds: isStringArray(env.findingIds) ? env.findingIds : [],
  };
}

export function writeLetterDraft(
  storage: StorageLike | null,
  caseId: string,
  templateKey: string,
  draft: StoredLetterDraft,
  now: Date,
): void {
  if (storage === null) return;
  const typed = Object.values(draft.values).some((v) => v.trim().length > 0);
  if (!typed && draft.docIds.length === 0 && draft.findingIds.length === 0) {
    clearLetterDraft(storage, caseId, templateKey);
    return;
  }
  const envelope: Envelope = { version: 1, savedAt: now.toISOString(), ...draft };
  try {
    storage.setItem(letterDraftKey(caseId, templateKey), JSON.stringify(envelope));
  } catch {
    // Storage full or refused: the form still works, it just is not kept.
  }
}

export function clearLetterDraft(storage: StorageLike | null, caseId: string, templateKey: string): void {
  if (storage === null) return;
  try {
    storage.removeItem(letterDraftKey(caseId, templateKey));
  } catch {
    // Same as above.
  }
}

/** The browser's local storage, or null where touching it throws. */
export function localStorageOrNull(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
