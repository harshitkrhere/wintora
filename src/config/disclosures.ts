/**
 * Commercial disclosures.
 *
 * Two facts drive everything in this file, and both must be visible to a
 * customer BEFORE they pay rather than buried in Terms:
 *
 *   1. The seller is Wintora's operator. Razorpay is the payment gateway: it
 *      processes the card and the recurring charges, and its name may share
 *      the line on the customer's statement, but the customer's contract is
 *      with the operator, refunds are the operator's decision, and any tax due
 *      where the customer lives is the operator's obligation.
 *   2. The software is operated from India by an individual, not a company.
 *
 * Neither fact is a problem. Hiding either would be. A customer who is
 * surprised by an unfamiliar name on their statement disputes the charge, and
 * a chargeback costs far more than a clear sentence at checkout.
 *
 * LEGAL_REVIEW_REQUIRED: every string here is a commercial representation.
 * Have them reviewed before launch, and fill in the operator identity below.
 * See docs/LIMITATIONS.md.
 */

export interface SellerOfRecord {
  /** Who the customer contracts with. */
  readonly legalName: string;
  /**
   * GATEWAY: the operator sells and a processor moves the money.
   * MERCHANT_OF_RECORD: a third party is the legal seller (not the case now).
   */
  readonly role: 'GATEWAY' | 'MERCHANT_OF_RECORD';
  /** The payment processor named on the statement alongside the seller. */
  readonly processorName: string;
  /** What the customer will see on their card or bank statement. */
  readonly statementDescriptor: string;
  readonly handlesRefunds: boolean;
  readonly remitsTax: boolean;
  readonly termsUrl: string;
  readonly privacyUrl: string;
}

/**
 * VERIFY the statement descriptor against a real test transaction before
 * launch. Razorpay prefixes international card charges with its own name and
 * appends the business name from the dashboard; the value below is the
 * expected shape, not an observed one. An unrecognised descriptor is one of
 * the most common causes of consumer chargebacks, and chargebacks on a new
 * merchant account are expensive out of proportion to their number.
 */
export const SELLER_OF_RECORD: SellerOfRecord = {
  legalName: 'Wintora',
  role: 'GATEWAY',
  processorName: 'Razorpay',
  statementDescriptor: 'RAZORPAY*WINTORA',
  handlesRefunds: false,
  remitsTax: false,
  termsUrl: 'https://razorpay.com/terms/',
  privacyUrl: 'https://razorpay.com/privacy/',
};

/**
 * The operator: who actually provides the software and answers for it.
 *
 * LEGAL_REVIEW_REQUIRED. A subscription is a contract, and a contract needs a
 * named party. Trading as an individual is entirely lawful; trading as nobody
 * is not. Fill these in before taking a payment.
 */
export interface OperatorIdentity {
  readonly tradingName: string;
  /** Legal name of the individual or entity. NOT yet supplied. */
  readonly legalName: string | null;
  readonly countryOfEstablishment: 'IN';
  readonly contactEmail: string | null;
  /** A postal address for notices, shown on /contact when set. */
  readonly postalAddress: string | null;
  readonly registeredEntity: boolean;
}

export const OPERATOR: OperatorIdentity = {
  tradingName: 'Wintora',
  // Deliberately null rather than a placeholder that could ship as if real.
  legalName: null,
  countryOfEstablishment: 'IN',
  contactEmail: 'info@wintora.online',
  postalAddress: null,
  registeredEntity: false,
};

/** True when the operator identity is complete enough to sell to consumers. */
export function operatorIdentityComplete(): boolean {
  return OPERATOR.legalName !== null && OPERATOR.contactEmail !== null;
}

// ---------------------------------------------------------------------------
// Customer-facing copy
// ---------------------------------------------------------------------------

/** Shown on the pricing page and again at checkout, before payment. */
export const CHECKOUT_DISCLOSURES = {
  seller:
    `Your subscription is sold by ${OPERATOR.tradingName}, operated from India. ` +
    `Payments are processed by ${SELLER_OF_RECORD.processorName}, which handles your card ` +
    `details; Wintora never sees them.`,

  statement:
    `On your statement the charge will appear as ` +
    `"${SELLER_OF_RECORD.statementDescriptor}".`,

  tax:
    'The price shown is the price charged. If a sales tax or GST/HST applies where you ' +
    'live, it is shown before you pay, never added afterwards.',

  renewal:
    'Your subscription renews automatically at the same price until you cancel. ' +
    'The renewal date and amount are always shown on your subscription page.',

  cancellation:
    'You can cancel at any time, in one click, from your subscription page. Your ' +
    'paid features stay active until the end of the period you have already paid for.',

  refunds:
    'Refund requests go to us directly and we decide them under our refund policy. ' +
    'If we owe you a refund, it is returned to the card you paid with.',

  dataOnCancellation:
    'Cancelling never deletes your cases, documents or letters. Your account moves ' +
    'to the Free plan and everything stays where it is.',
} as const;

/**
 * Shown on the billing page after purchase, so a customer reconciling a card
 * statement months later can work out what the charge was.
 */
export const BILLING_PAGE_DISCLOSURES = {
  whoCharged:
    `Payments are processed by ${SELLER_OF_RECORD.processorName} on behalf of ` +
    `${OPERATOR.tradingName}, and appear on your statement as ` +
    `"${SELLER_OF_RECORD.statementDescriptor}".`,
  invoiceSource:
    `Invoices are issued for each charge and show the amount, the currency and any tax.`,
  refundRoute:
    'For a refund or a billing question, contact us and we will resolve it with you directly.',
} as const;

/**
 * The order in which a checkout must present things.
 *
 * Deliberately explicit so a redesign cannot quietly drop a required
 * disclosure. `tests/disclosures.test.ts` asserts each is non-empty and that
 * price, renewal and cancellation all appear before the pay action.
 */
export const CHECKOUT_DISCLOSURE_ORDER: readonly (keyof typeof CHECKOUT_DISCLOSURES)[] = [
  'seller',
  'statement',
  'tax',
  'renewal',
  'cancellation',
  'refunds',
  'dataOnCancellation',
];
