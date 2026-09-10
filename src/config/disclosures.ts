/**
 * Commercial disclosures.
 *
 * Two facts drive everything in this file, and both must be visible to a
 * customer BEFORE they pay rather than buried in Terms:
 *
 *   1. The seller of record is Paddle, not Wintora. The customer's purchase
 *      contract is with Paddle, Paddle's name appears on their card statement,
 *      Paddle collects and remits the tax, and Paddle decides refunds under its
 *      own buyer terms.
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
  /** Legal entity the customer actually contracts with. */
  readonly legalName: string;
  readonly role: 'MERCHANT_OF_RECORD';
  /** What the customer will see on their card or bank statement. */
  readonly statementDescriptor: string;
  readonly handlesRefunds: boolean;
  readonly remitsTax: boolean;
  readonly termsUrl: string;
  readonly privacyUrl: string;
}

/**
 * VERIFY the statement descriptor against a real test transaction before
 * launch. An unrecognised descriptor is one of the most common causes of
 * consumer chargebacks, and chargebacks on a new merchant account are
 * expensive out of proportion to their number.
 */
export const SELLER_OF_RECORD: SellerOfRecord = {
  legalName: 'Paddle.com Market Ltd',
  role: 'MERCHANT_OF_RECORD',
  statementDescriptor: 'PADDLE.NET* WINTORA',
  handlesRefunds: true,
  remitsTax: true,
  termsUrl: 'https://www.paddle.com/legal/terms',
  privacyUrl: 'https://www.paddle.com/legal/privacy',
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
  readonly registeredEntity: boolean;
}

export const OPERATOR: OperatorIdentity = {
  tradingName: 'Wintora',
  // Deliberately null rather than a placeholder that could ship as if real.
  legalName: null,
  countryOfEstablishment: 'IN',
  contactEmail: 'info@wintora.online',
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
    `Your subscription is sold by ${SELLER_OF_RECORD.legalName}, our authorised reseller. ` +
    `They handle the payment, the tax and any refund. Wintora provides the software.`,

  statement:
    `On your statement the charge will appear as ` +
    `"${SELLER_OF_RECORD.statementDescriptor}", not as Wintora.`,

  tax:
    'Any sales tax, VAT or GST that applies where you live is calculated at ' +
    'checkout and shown before you pay.',

  renewal:
    'Your subscription renews automatically at the same price until you cancel. ' +
    'The renewal date and amount are always shown on your subscription page.',

  cancellation:
    'You can cancel at any time, in one click, from your subscription page. Your ' +
    'paid features stay active until the end of the period you have already paid for.',

  refunds:
    `Refunds are handled by ${SELLER_OF_RECORD.legalName} under their buyer terms. ` +
    `Contact us first and we will help, but the refund decision is theirs to make.`,

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
    `Payments are collected by ${SELLER_OF_RECORD.legalName} as the seller of record.`,
  invoiceSource:
    'Your invoices are issued by the seller of record and include any tax charged.',
  refundRoute:
    'For a refund or a billing dispute, contact us and we will raise it with the ' +
    'seller of record on your behalf.',
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
