/**
 * Contextual disclaimers.
 *
 * A disclaimer buried in the Terms is not a disclaimer. These appear at the
 * moment they are relevant: on the analysis result, above a generated letter,
 * next to a deadline, on jurisdiction content.
 *
 * The language is plain and non-defensive. The aim is that a user understands
 * the boundary, not that a lawyer can point at a paragraph later.
 */

export const GLOBAL_DISCLAIMER =
  'Wintora provides general information and administrative assistance. It does ' +
  'not provide legal or medical advice, and it does not represent you before a ' +
  'provider, insurer, government agency, court or any other organisation.';

export type DisclaimerContext =
  | 'ANALYSIS_RESULT'
  | 'LETTER_DRAFT'
  | 'LETTER_FINALIZE'
  | 'DEADLINE_UNVERIFIED'
  | 'DEADLINE_VERIFIED'
  | 'JURISDICTION_CONTENT'
  | 'EOB_COMPARISON'
  | 'FINANCIAL_ASSISTANCE'
  | 'COLLECTIONS'
  | 'APPEAL'
  | 'PUBLIC_TOOL';

export const DISCLAIMERS: Readonly<Record<DisclaimerContext, string>> = {
  ANALYSIS_RESULT:
    'These checks compare what is printed on your documents. They cannot tell ' +
    'you whether a charge was medically appropriate, what your care should have ' +
    'cost, or what your insurer will decide. Anything flagged here is a question ' +
    'worth asking, not a conclusion.',

  LETTER_DRAFT:
    'This is a draft for you to review and edit. Check every detail before you ' +
    'send it. Wintora does not send anything on your behalf.',

  LETTER_FINALIZE:
    'You are responsible for what you send. Please confirm the details are ' +
    'accurate to the best of your knowledge.',

  DEADLINE_UNVERIFIED:
    'This date is one you entered yourself. Wintora has not verified it against ' +
    'an official source and it is not legal advice about a deadline that applies ' +
    'to you.',

  DEADLINE_VERIFIED:
    'This date comes from the source cited below. Deadlines can change and can ' +
    'depend on your specific circumstances, so confirm it with the organisation ' +
    'involved.',

  JURISDICTION_CONTENT:
    'This describes a publicly documented administrative process. It is general ' +
    'information, not legal advice, and it may not fit your situation.',

  EOB_COMPARISON:
    'This compares the figures printed on the two documents you uploaded. A ' +
    'difference between them is common and often has an ordinary explanation. It ' +
    'is a reason to ask a question, not evidence that anyone did anything wrong.',

  FINANCIAL_ASSISTANCE:
    'Eligibility is decided entirely by the provider or programme. Wintora can ' +
    'help you find and prepare an application; it cannot tell you whether you ' +
    'will qualify.',

  COLLECTIONS:
    'If an account is with a collection agency, the rules that apply depend on ' +
    'where you live and on your circumstances. This is general information. ' +
    'Consider speaking to a qualified adviser or a local consumer assistance ' +
    'service.',

  APPEAL:
    'An appeal is decided by your insurer, and then possibly by an external ' +
    'reviewer. Wintora helps you organise and prepare the paperwork. It cannot ' +
    'predict or influence the outcome.',

  PUBLIC_TOOL:
    'This tool runs in your browser session and checks the figures you provide. ' +
    'Nothing is stored unless you create an account and save it.',
};

/**
 * Statements the product must never make. Used by the AI output validator and
 * by a copy-review test over user-facing strings.
 * See docs/AI_SAFETY.md section 3.
 */
export const PROHIBITED_CLAIMS: readonly string[] = [
  'guaranteed',
  'we guarantee',
  'you will win',
  'you will save',
  'legally required to',
  'this is illegal',
  'they broke the law',
  'they violated',
  'you have a claim',
  'sue them',
  'fraud',
  'they are stealing',
  'deliberately overcharged',
  'hipaa certified',
  'government approved',
  '100% secure',
  'fully compliant',
];

/**
 * What the product tells users about its own limits, shown as prominently as
 * the capability list. A user who understands the boundary trusts the parts
 * inside it more.
 */
export const CAPABILITY_STATEMENT = {
  does: [
    'Reads the documents you upload and extracts the line items and totals',
    'Checks the arithmetic and internal consistency of a statement',
    'Compares a bill against an EOB when you provide both',
    'Points out entries that may need clarification, and shows you the numbers',
    'Prepares request letters for you to review and send yourself',
    'Keeps your documents, dates and correspondence organised in one place',
  ],
  doesNot: [
    'Know what your care should have cost',
    'Know your insurance policy terms unless you upload them',
    'Know whether a charge was medically appropriate',
    'Know what your provider or insurer will decide',
    'Give legal or medical advice',
    'Represent you, or contact anyone on your behalf',
  ],
} as const;
