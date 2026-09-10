/**
 * Redaction.
 *
 * Runs before any model call and before any log write. Identifiers are replaced
 * with STABLE placeholders (`[NAME_1]`, `[MEMBER_ID_1]`) so relationships in the
 * text survive but identity does not: "Bill for [NAME_1], member [MEMBER_ID_1]"
 * is still analysable, and still anonymous.
 *
 * This is defence in depth, not the primary control. The primary control is
 * minimisation: only send the fields a task actually needs. See
 * docs/PRIVACY.md section 5.
 *
 * Pure module: no I/O.
 */

export type RedactionCategory =
  | 'SSN'
  | 'SIN'
  | 'MEMBER_ID'
  | 'ACCOUNT_NUMBER'
  | 'MRN'
  | 'DOB'
  | 'EMAIL'
  | 'PHONE'
  | 'ADDRESS'
  | 'POSTAL_CODE'
  | 'CARD_NUMBER'
  | 'NAME';

export interface RedactionResult {
  readonly text: string;
  /** placeholder -> category, for auditing what was found. Never the values. */
  readonly placeholders: Readonly<Record<string, RedactionCategory>>;
  readonly counts: Readonly<Partial<Record<RedactionCategory, number>>>;
  /**
   * True when redaction could not run confidently. Callers must skip the AI
   * step entirely rather than send partially redacted text. Failing closed
   * costs a nicer sentence; failing open costs a person their privacy.
   */
  readonly degraded: boolean;
}

interface Pattern {
  readonly category: RedactionCategory;
  readonly regex: RegExp;
  /** Capture group holding the value, when the match includes a label. */
  readonly group?: number;
}

/**
 * Order matters. More specific patterns run first so a US SSN is not first
 * eaten by a looser rule.
 *
 * Card numbers are deliberately NOT in this list. A bare "13 to 19 digits with
 * separators" rule also matches UUIDs, long account numbers and reference
 * codes, and destroying the opaque identifiers that logs and audit trails
 * depend on is its own kind of failure. They are handled separately below,
 * where a Luhn check decides.
 */
const PATTERNS: readonly Pattern[] = [
  { category: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    category: 'SSN',
    regex: /\b(?:ssn|social security(?: number)?)\s*[:#]?\s*(\d{3}[- ]?\d{2}[- ]?\d{4})\b/gi,
    group: 1,
  },
  {
    category: 'SIN',
    regex: /\b(?:sin|social insurance(?: number)?)\s*[:#]?\s*(\d{3}[- ]?\d{3}[- ]?\d{3})\b/gi,
    group: 1,
  },
  {
    category: 'MEMBER_ID',
    regex:
      /\b(?:member|subscriber|policy|group|plan|certificate)\s*(?:id|no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})\b/gi,
    group: 1,
  },
  {
    category: 'MRN',
    regex: /\b(?:mrn|medical record(?: number)?|patient(?: id)?)\s*[:#]?\s*([A-Z0-9-]{4,})\b/gi,
    group: 1,
  },
  {
    category: 'ACCOUNT_NUMBER',
    regex:
      /\b(?:account|acct|statement|invoice|claim|guarantor)\s*(?:no\.?|number|id|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/gi,
    group: 1,
  },
  {
    category: 'DOB',
    regex:
      /\b(?:dob|date of birth|birth ?date)\s*[:#]?\s*(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})\b/gi,
    group: 1,
  },
  { category: 'EMAIL', regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  {
    category: 'PHONE',
    regex: /(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g,
  },
  // Canadian postal code and US ZIP+4.
  { category: 'POSTAL_CODE', regex: /\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/g },
  { category: 'POSTAL_CODE', regex: /\b\d{5}-\d{4}\b/g },
  {
    category: 'ADDRESS',
    regex:
      /\b\d{1,6}\s+(?:[A-Z][a-zA-Z.]*\s+){1,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|terrace|ter|circle|cir|highway|hwy|suite|ste|apt|unit)\b\.?/gi,
  },
];

/**
 * Names cannot be found reliably by pattern, so they are redacted from a
 * supplied list of known names (the account holder, the household members)
 * rather than guessed. Guessing at names in clinical text produces both misses
 * and mangled medical terms.
 */
export interface RedactOptions {
  readonly knownNames?: readonly string[];
  /** Refuse to process text longer than this rather than truncate silently. */
  readonly maxLength?: number;
}

/**
 * Luhn check digit, as used by every major card scheme.
 *
 * This is what separates a real card number from a UUID, an account reference
 * or a claim number that happens to be long.
 */
export function isLuhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const code = digits.charCodeAt(i) - 48;
    if (code < 0 || code > 9) return false;

    let value = code;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }

  return sum % 10 === 0;
}

const DEFAULT_MAX_LENGTH = 500_000;

/** Our own opaque references. Masked out so nothing else mangles them. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A run of 13 to 19 digits with optional separators. Luhn decides. */
const CARD_CANDIDATE_RE = /\b\d(?:[ -]?\d){12,18}\b/g;

/**
 * NUL delimiters for the preserved-token sentinel: they cannot occur in
 * extracted document text, they are not word characters so they do not join
 * adjacent tokens, and no pattern above matches them.
 */
const SENTINEL_RE = /\u0000(\d+)\u0000/g;

function sentinel(index: number): string {
  return `\u0000${index}\u0000`;
}

export function redact(input: string, options: RedactOptions = {}): RedactionResult {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;

  if (typeof input !== 'string') {
    return { text: '', placeholders: {}, counts: {}, degraded: true };
  }
  if (input.length > maxLength) {
    // Fail closed: the caller must not send this to a model.
    return { text: '', placeholders: {}, counts: {}, degraded: true };
  }

  const placeholders: Record<string, RedactionCategory> = {};
  const counts: Partial<Record<RedactionCategory, number>> = {};
  const seen = new Map<string, string>();

  const placeholderFor = (category: RedactionCategory, value: string): string => {
    const key = `${category}:${value.toLowerCase().replace(/[\s-]/g, '')}`;
    const existing = seen.get(key);
    if (existing !== undefined) return existing;

    const next = (counts[category] ?? 0) + 1;
    counts[category] = next;
    const token = `[${category}_${next}]`;
    seen.set(key, token);
    placeholders[token] = category;
    return token;
  };

  let text = input;

  // 1. Protect our own opaque identifiers. A UUID is a reference we deliberately
  //    WANT in logs and audit trails, and it is long enough to be mistaken for a
  //    card or an account number.
  const preserved: string[] = [];
  text = text.replace(UUID_RE, (match) => {
    preserved.push(match);
    return sentinel(preserved.length - 1);
  });

  // 2. Card numbers, and only when the digits actually pass a Luhn check.
  text = text.replace(CARD_CANDIDATE_RE, (match) => {
    const digits = match.replace(/[ -]/g, '');
    return isLuhnValid(digits) ? placeholderFor('CARD_NUMBER', digits) : match;
  });

  // 3. Structured, high-precision patterns, so an email address is redacted
  //    whole rather than having its local part chewed up by the name pass.
  for (const pattern of PATTERNS) {
    text = text.replace(pattern.regex, (match, ...groups) => {
      const captured =
        pattern.group !== undefined ? (groups[pattern.group - 1] as string | undefined) : match;
      if (captured === undefined || captured.length === 0) return match;

      const token = placeholderFor(pattern.category, captured);
      // Preserve the label so the surrounding text still reads sensibly:
      // "Account number: [ACCOUNT_NUMBER_1]".
      return pattern.group === undefined ? token : match.replace(captured, token);
    });
  }

  // 4. Names last: this is the fuzzy pass, so it runs over what the precise
  //    patterns left behind.
  for (const name of options.knownNames ?? []) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue;
    for (const part of [trimmed, ...trimmed.split(/\s+/)]) {
      if (part.length < 3) continue;
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), () =>
        placeholderFor('NAME', trimmed),
      );
    }
  }

  // 5. Restore the preserved references exactly as they were.
  text = text.replace(SENTINEL_RE, (_match, index: string) => preserved[Number(index)] ?? '');

  return { text, placeholders, counts, degraded: false };
}

/**
 * Recursively redact a structured payload before it is logged.
 *
 * Keys whose names indicate sensitive content are dropped entirely rather than
 * pattern-matched, because a value under `diagnosis` is sensitive whatever it
 * looks like.
 */
const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'ssn',
  'sin',
  'dob',
  'dateofbirth',
  'diagnosis',
  'diagnoses',
  'icd',
  'clinicalnotes',
  'documenttext',
  'extractedtext',
  'content',
  'body',
  'memberid',
  'policynumber',
  'cardnumber',
  'cvv',
  'cvc',
  'pan',
];

export const REDACTED = '[REDACTED]';

export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;

  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redact(value).text;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactObject(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, '');
      out[key] = SENSITIVE_KEYS.includes(normalized) ? REDACTED : redactObject(v, depth + 1);
    }
    return out;
  }

  return REDACTED;
}

/**
 * Does this text still contain something that looks like a direct identifier?
 * Used as an assertion in tests and as a last check before an outbound call.
 */
export function containsLikelyIdentifier(text: string): boolean {
  const checks: readonly RegExp[] = [
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, // email
    /\b\d{3}[ .-]\d{3}[ .-]\d{4}\b/, // phone
  ];
  if (checks.some((re) => re.test(text))) return true;

  // Luhn-valid rather than merely long, for the same reason as above.
  for (const match of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    if (isLuhnValid(match[0].replace(/[ -]/g, ''))) return true;
  }
  return false;
}
