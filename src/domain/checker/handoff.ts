/**
 * Carrying typed figures across sign-up, in the browser only.
 *
 * Someone who used the free checker and then decides to keep the result
 * should not retype it. The figures they typed (the inputs, never the
 * findings) are held in sessionStorage under a versioned key until they
 * choose to save them into an account, at which point the ordinary save path
 * sends them to the server and the engine runs again there. Nothing leaves
 * the browser until that click, and nothing computed in the browser is ever
 * trusted.
 *
 * Storage is injected so the module stays pure and testable; the browser
 * passes window.sessionStorage. Every read tolerates missing, corrupt or
 * outdated data by returning null rather than throwing.
 */

import { parseMoneyToCents } from '@/domain/documents/draft';
import type { ExtractionDraft } from '@/domain/documents/draft';

export const HANDOFF_KEY = 'wintora.checker.v1';
export const HANDOFF_VERSION = 1 as const;

/** The smallest thing storage needs to be. window.sessionStorage satisfies it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HandoffLine {
  readonly description: string;
  readonly code: string;
  readonly amount: string;
}

/** The form's values as typed, all strings, exactly as the inputs hold them. */
export interface HandoffFigures {
  readonly currency: 'USD' | 'CAD';
  readonly lines: readonly HandoffLine[];
  readonly subtotal: string;
  readonly total: string;
  readonly adjustments: string;
  readonly insurancePaid: string;
  readonly tax: string;
  readonly payments: string;
  readonly amountDue: string;
  readonly statementDate: string;
  readonly accountReference: string;
}

export interface CheckerHandoff extends HandoffFigures {
  readonly v: typeof HANDOFF_VERSION;
  readonly savedAt: string;
}

const MAX_LINES = 500;
const MAX_TEXT = 500;

function str(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function saveHandoff(storage: StorageLike, figures: HandoffFigures, now: Date = new Date()): boolean {
  try {
    const record: CheckerHandoff = { ...figures, v: HANDOFF_VERSION, savedAt: now.toISOString() };
    storage.setItem(HANDOFF_KEY, JSON.stringify(record));
    return true;
  } catch {
    // Storage full, disabled, or unavailable. The person can still sign up
    // and type the figures again; nothing worse happens.
    return false;
  }
}

/** The stored figures, or null for anything missing, corrupt or of another version. */
export function readHandoff(storage: StorageLike): CheckerHandoff | null {
  let raw: string | null;
  try {
    raw = storage.getItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (p.v !== HANDOFF_VERSION) return null;
  if (!Array.isArray(p.lines)) return null;

  const lines: HandoffLine[] = p.lines.slice(0, MAX_LINES).flatMap((l) => {
    if (typeof l !== 'object' || l === null) return [];
    const line = l as Record<string, unknown>;
    return [{ description: str(line.description), code: str(line.code, 40), amount: str(line.amount, 40) }];
  });

  return {
    v: HANDOFF_VERSION,
    savedAt: str(p.savedAt, 40),
    currency: p.currency === 'CAD' ? 'CAD' : 'USD',
    lines,
    subtotal: str(p.subtotal, 40),
    total: str(p.total, 40),
    adjustments: str(p.adjustments, 40),
    insurancePaid: str(p.insurancePaid, 40),
    tax: str(p.tax, 40),
    payments: str(p.payments, 40),
    amountDue: str(p.amountDue, 40),
    statementDate: str(p.statementDate, 40),
    accountReference: str(p.accountReference, 120),
  };
}

export function clearHandoff(storage: StorageLike): void {
  try {
    storage.removeItem(HANDOFF_KEY);
  } catch {
    // Nothing to do: if storage is unavailable there is nothing stored.
  }
}

/**
 * The stored figures as a draft the confirm-figures form can be pre-filled
 * from. Every value stays editable there, and the engine only ever sees what
 * the person confirms.
 */
export function handoffToDraft(h: CheckerHandoff): ExtractionDraft {
  const money = (s: string): { amountCents: number; confidence: 'HIGH' } | null => {
    const cents = parseMoneyToCents(s);
    return cents === null ? null : { amountCents: cents, confidence: 'HIGH' };
  };
  const text = (s: string): { value: string; confidence: 'HIGH' } | null =>
    s.trim().length > 0 ? { value: s.trim(), confidence: 'HIGH' } : null;

  return {
    engine: 'typed',
    engineVersion: '1',
    currency: h.currency,
    lineItems: h.lines
      .filter((l) => l.description.trim().length > 0)
      .map((l) => ({
        description: l.description.trim(),
        amountCents: parseMoneyToCents(l.amount),
        ...(l.code.trim().length > 0 ? { code: l.code.trim() } : {}),
        confidence: 'HIGH' as const,
      })),
    subtotal: money(h.subtotal),
    total: money(h.total),
    amountDue: money(h.amountDue),
    insurancePaid: money(h.insurancePaid),
    adjustments: money(h.adjustments),
    previousBalance: null,
    tax: money(h.tax),
    payments: money(h.payments),
    statementDate: /^\d{4}-\d{2}-\d{2}$/.test(h.statementDate) ? { value: h.statementDate, confidence: 'HIGH' } : null,
    providerName: null,
    accountReference: text(h.accountReference),
    pageCount: null,
    overallConfidence: 'HIGH',
    notes: [],
  };
}
