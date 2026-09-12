/**
 * The single feature registry.
 *
 * The pricing page, the comparison table, the paywalls, the benefits panel and
 * the backend authorization all read from here. That is what makes it
 * impossible to advertise a feature the backend does not enforce.
 *
 * This file seeds `public.features`. After seeding, the database is the
 * operational source of truth; `tests/catalog-parity.test.ts` asserts the two
 * never drift apart.
 */

export const FEATURE_TYPES = [
  'BOOLEAN',
  'LIMIT',
  'QUOTA',
  'RETENTION',
  'SUPPORT_LEVEL',
] as const;
export type FeatureType = (typeof FEATURE_TYPES)[number];

/** Drives model routing and margin protection. See docs/BILLING.md section 11. */
export const COST_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type CostLevel = (typeof COST_LEVELS)[number];

export interface FeatureDefinition {
  readonly key: FeatureKey;
  readonly name: string;
  readonly description: string;
  /** Shown verbatim to customers. Never write a benefit the backend cannot honour. */
  readonly benefitText: string;
  readonly type: FeatureType;
  readonly costLevel: CostLevel;
  readonly sortOrder: number;
  /**
   * Can a customer actually use this today?
   *
   * The registry is the single source for what a plan INCLUDES, and every
   * customer-facing list is rendered from it. That is the right design, and it
   * has a failure mode: a feature that is planned, priced and entitled but not
   * yet built renders as "now active" on the success page two seconds after
   * someone pays for it. This flag lets those pages tell the truth from the
   * same source, rather than relying on a hand-written note someone has to
   * remember to update. Required, so a new feature cannot forget to declare it.
   */
  readonly available: boolean;
  /**
   * True for features that are user rights rather than commercial features.
   * No plan may disable these, and `computeEntitlements` enforces that
   * regardless of what the plan matrix says.
   */
  readonly inalienable?: boolean;
  /** Metered features consume quota through `consume_usage`. */
  readonly metered?: boolean;
}

export const FEATURE_KEYS = [
  'DOCUMENT_UPLOAD',
  'BASIC_BILL_ANALYSIS',
  'ADVANCED_DOCUMENT_ANALYSIS',
  'EOB_COMPARISON',
  'LETTER_GENERATION',
  'ADVANCED_LETTERS',
  'PREMIUM_TEMPLATES',
  'CASE_TRACKING',
  'MULTIPLE_CASES',
  'CASE_TIMELINE',
  'REMINDERS',
  'DEADLINE_TRACKING',
  'ADVANCED_EXPORT',
  'HOUSEHOLD_CASES',
  'EXTENDED_HISTORY',
  'PRIORITY_SUPPORT',
  'DATA_EXPORT',
  'ACCOUNT_DELETION',
  'MAX_ACTIVE_CASES',
  'MONTHLY_DOCUMENTS',
  'MONTHLY_ANALYSES',
  'MONTHLY_LETTERS',
  'MONTHLY_EXPORTS',
  'MAX_FILE_SIZE_MB',
  'STORAGE_LIMIT_MB',
  'RETENTION_DAYS',
  'HOUSEHOLD_MEMBERS',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURES: Readonly<Record<FeatureKey, FeatureDefinition>> = {
  DOCUMENT_UPLOAD: {
    key: 'DOCUMENT_UPLOAD',
    available: true,
    name: 'Document upload',
    description: 'Upload bills, EOBs and correspondence to a case.',
    benefitText: 'Upload your bills and statements',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 10,
  },
  BASIC_BILL_ANALYSIS: {
    key: 'BASIC_BILL_ANALYSIS',
    available: true,
    name: 'Bill analysis',
    description: 'Deterministic arithmetic and internal-consistency checks.',
    benefitText: 'Check a bill for arithmetic and consistency problems',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 20,
  },
  ADVANCED_DOCUMENT_ANALYSIS: {
    key: 'ADVANCED_DOCUMENT_ANALYSIS',
    available: false,
    name: 'Advanced document analysis',
    description: 'Cross-document reconciliation and richer line-item comparison.',
    benefitText: 'Advanced cross-document analysis',
    type: 'BOOLEAN',
    costLevel: 'HIGH',
    sortOrder: 30,
  },
  EOB_COMPARISON: {
    key: 'EOB_COMPARISON',
    available: true,
    name: 'Bill vs EOB comparison',
    description: 'Compare a provider bill against an explanation of benefits.',
    benefitText: 'Compare a bill against your EOB',
    type: 'BOOLEAN',
    costLevel: 'MEDIUM',
    sortOrder: 40,
  },
  LETTER_GENERATION: {
    key: 'LETTER_GENERATION',
    available: false,
    name: 'Request letters',
    description: 'Generate administrative request drafts you review and send.',
    benefitText: 'Prepare request letters to review and send yourself',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 50,
  },
  ADVANCED_LETTERS: {
    key: 'ADVANCED_LETTERS',
    available: false,
    name: 'Advanced letter drafts',
    description: 'Multi-part correspondence with evidence attachments.',
    benefitText: 'Advanced correspondence drafts',
    type: 'BOOLEAN',
    costLevel: 'MEDIUM',
    sortOrder: 60,
  },
  PREMIUM_TEMPLATES: {
    key: 'PREMIUM_TEMPLATES',
    available: false,
    name: 'Premium templates',
    description: 'The full reviewed template library.',
    benefitText: 'The full template library',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 70,
  },
  CASE_TRACKING: {
    key: 'CASE_TRACKING',
    available: true,
    name: 'Case tracking',
    description: 'Organise a bill into a case with documents and status.',
    benefitText: 'Keep each bill organised as a case',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 80,
  },
  MULTIPLE_CASES: {
    key: 'MULTIPLE_CASES',
    available: true,
    name: 'Multiple cases',
    description: 'Run more than one case at a time.',
    benefitText: 'Work on several bills at once',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 90,
  },
  CASE_TIMELINE: {
    key: 'CASE_TIMELINE',
    available: true,
    name: 'Case timeline',
    description: 'A dated record of what happened and when.',
    benefitText: 'A complete timeline of your case',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 100,
  },
  REMINDERS: {
    key: 'REMINDERS',
    available: false,
    name: 'Reminders',
    description: 'Schedule follow-up reminders on a case.',
    benefitText: 'Follow-up reminders so nothing is missed',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 110,
  },
  DEADLINE_TRACKING: {
    key: 'DEADLINE_TRACKING',
    available: false,
    name: 'Deadline tracking',
    description: 'Track verified and user-entered dates, clearly distinguished.',
    benefitText: 'Track your important dates',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 120,
  },
  ADVANCED_EXPORT: {
    key: 'ADVANCED_EXPORT',
    available: false,
    name: 'Advanced export',
    description: 'Export a full case bundle as PDF or DOCX with attachments.',
    benefitText: 'Export a complete case bundle',
    type: 'BOOLEAN',
    costLevel: 'MEDIUM',
    sortOrder: 130,
  },
  HOUSEHOLD_CASES: {
    key: 'HOUSEHOLD_CASES',
    available: false,
    name: 'Household cases',
    description: 'Track cases for more than one person in the household.',
    benefitText: 'Manage bills for your whole household',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 140,
  },
  EXTENDED_HISTORY: {
    key: 'EXTENDED_HISTORY',
    available: false,
    name: 'Extended history',
    description: 'Longer retention of case and analysis history.',
    benefitText: 'Keep your history for longer',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 150,
  },
  PRIORITY_SUPPORT: {
    key: 'PRIORITY_SUPPORT',
    available: false,
    name: 'Priority support',
    description: 'Support queue priority with a published response target.',
    benefitText: 'Priority support with a published response target',
    type: 'SUPPORT_LEVEL',
    costLevel: 'LOW',
    sortOrder: 160,
  },
  DATA_EXPORT: {
    key: 'DATA_EXPORT',
    available: true,
    name: 'Data export',
    description: 'Download everything held about you.',
    benefitText: 'Download all your data at any time',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 170,
    inalienable: true,
  },
  ACCOUNT_DELETION: {
    key: 'ACCOUNT_DELETION',
    available: true,
    name: 'Account deletion',
    description: 'Delete your account and content.',
    benefitText: 'Delete your account and content at any time',
    type: 'BOOLEAN',
    costLevel: 'LOW',
    sortOrder: 180,
    inalienable: true,
  },

  MAX_ACTIVE_CASES: {
    key: 'MAX_ACTIVE_CASES',
    available: true,
    name: 'Active cases',
    description: 'How many cases may be open at once.',
    benefitText: 'Active cases',
    type: 'LIMIT',
    costLevel: 'LOW',
    sortOrder: 200,
  },
  MONTHLY_DOCUMENTS: {
    key: 'MONTHLY_DOCUMENTS',
    available: true,
    name: 'Documents per period',
    description: 'Document uploads per billing period.',
    benefitText: 'Document uploads per billing period',
    type: 'QUOTA',
    costLevel: 'MEDIUM',
    sortOrder: 210,
    metered: true,
  },
  MONTHLY_ANALYSES: {
    key: 'MONTHLY_ANALYSES',
    available: true,
    name: 'Analyses per period',
    description: 'Analysis runs per billing period.',
    benefitText: 'Analyses per billing period',
    type: 'QUOTA',
    costLevel: 'HIGH',
    sortOrder: 220,
    metered: true,
  },
  MONTHLY_LETTERS: {
    key: 'MONTHLY_LETTERS',
    available: false,
    name: 'Letters per period',
    description: 'Letter drafts per billing period.',
    benefitText: 'Letter drafts per billing period',
    type: 'QUOTA',
    costLevel: 'MEDIUM',
    sortOrder: 230,
    metered: true,
  },
  MONTHLY_EXPORTS: {
    key: 'MONTHLY_EXPORTS',
    available: false,
    name: 'Exports per period',
    description: 'Case exports per billing period.',
    benefitText: 'Case exports per billing period',
    type: 'QUOTA',
    costLevel: 'LOW',
    sortOrder: 240,
    metered: true,
  },
  MAX_FILE_SIZE_MB: {
    key: 'MAX_FILE_SIZE_MB',
    available: true,
    name: 'Maximum file size',
    description: 'Largest single upload, in megabytes.',
    benefitText: 'Maximum file size',
    type: 'LIMIT',
    costLevel: 'LOW',
    sortOrder: 250,
  },
  STORAGE_LIMIT_MB: {
    key: 'STORAGE_LIMIT_MB',
    available: true,
    name: 'Storage',
    description: 'Total stored document size, in megabytes.',
    benefitText: 'Document storage',
    type: 'LIMIT',
    costLevel: 'LOW',
    sortOrder: 260,
  },
  RETENTION_DAYS: {
    key: 'RETENTION_DAYS',
    available: true,
    name: 'Document retention',
    description: 'How long uploaded documents are kept before automatic removal.',
    benefitText: 'Document retention',
    type: 'RETENTION',
    costLevel: 'LOW',
    sortOrder: 270,
  },
  HOUSEHOLD_MEMBERS: {
    key: 'HOUSEHOLD_MEMBERS',
    available: false,
    name: 'Household members',
    description: 'How many people may be tracked on this account.',
    benefitText: 'People covered',
    type: 'LIMIT',
    costLevel: 'LOW',
    sortOrder: 280,
  },
};

export const ALL_FEATURES: readonly FeatureDefinition[] = FEATURE_KEYS.map(
  (k) => FEATURES[k],
);

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function getFeature(key: FeatureKey): FeatureDefinition {
  return FEATURES[key];
}

/** Features that consume a quota window and therefore go through the meter. */
export const METERED_FEATURES: readonly FeatureKey[] = ALL_FEATURES.filter(
  (f) => f.metered === true,
).map((f) => f.key);

/** Features no plan may switch off. See docs/ENTITLEMENTS.md section 2. */
export const INALIENABLE_FEATURES: readonly FeatureKey[] = ALL_FEATURES.filter(
  (f) => f.inalienable === true,
).map((f) => f.key);
