/**
 * Commercial disclosures.
 *
 * These strings are representations made to a customer before they pay. Two
 * of them are not optional: who the customer is actually contracting with, and
 * what name will appear on their statement.
 *
 * An unrecognised statement descriptor is one of the commonest causes of a
 * consumer chargeback, and chargebacks on a new merchant account cost far more
 * than the transaction.
 */

import { describe, expect, it } from 'vitest';
import {
  BILLING_PAGE_DISCLOSURES,
  CHECKOUT_DISCLOSURES,
  CHECKOUT_DISCLOSURE_ORDER,
  OPERATOR,
  SELLER_OF_RECORD,
  operatorIdentityComplete,
} from '@/config/disclosures';
import { PROHIBITED_CLAIMS } from '@/config/disclaimers';

describe('seller of record', () => {
  it('names the party the customer actually contracts with', () => {
    expect(SELLER_OF_RECORD.legalName.length).toBeGreaterThan(0);
    // A gateway processes; we sell. That makes tax and refunds ours.
    expect(SELLER_OF_RECORD.role).toBe('GATEWAY');
    expect(SELLER_OF_RECORD.legalName).toBe(OPERATOR.tradingName);
  });

  it('records that under a gateway refunds and tax are ours, not the processor\'s', () => {
    // Both change what we may promise a customer, and both are obligations we
    // now carry rather than a reaction to someone else's decision.
    expect(SELLER_OF_RECORD.handlesRefunds).toBe(false);
    expect(SELLER_OF_RECORD.remitsTax).toBe(false);
  });

  it('declares a statement descriptor that names both the processor and us', () => {
    expect(SELLER_OF_RECORD.statementDescriptor.length).toBeGreaterThan(0);
    // Razorpay prefixes card charges with its own name; a descriptor that
    // omitted it would not match what the customer sees.
    expect(SELLER_OF_RECORD.statementDescriptor.toLowerCase()).toContain('razorpay');
    expect(SELLER_OF_RECORD.statementDescriptor.toLowerCase()).toContain('wintora');
  });

  it('links the seller terms and privacy notice', () => {
    for (const url of [SELLER_OF_RECORD.termsUrl, SELLER_OF_RECORD.privacyUrl]) {
      expect(() => new URL(url)).not.toThrow();
      expect(url.startsWith('https://')).toBe(true);
    }
  });
});

describe('checkout disclosures', () => {
  it('has copy for every required disclosure', () => {
    for (const key of CHECKOUT_DISCLOSURE_ORDER) {
      const text = CHECKOUT_DISCLOSURES[key];
      expect(text, key).toBeDefined();
      expect(text.trim().length, key).toBeGreaterThan(20);
    }
  });

  it('covers the things a customer must know before paying', () => {
    // Price and plan come from the live catalog; these are the commitments.
    expect(CHECKOUT_DISCLOSURE_ORDER).toContain('seller');
    expect(CHECKOUT_DISCLOSURE_ORDER).toContain('statement');
    expect(CHECKOUT_DISCLOSURE_ORDER).toContain('tax');
    expect(CHECKOUT_DISCLOSURE_ORDER).toContain('renewal');
    expect(CHECKOUT_DISCLOSURE_ORDER).toContain('cancellation');
  });

  it('states that the subscription renews automatically', () => {
    // Hiding auto-renewal is the single most regulated dark pattern in
    // consumer subscriptions.
    expect(CHECKOUT_DISCLOSURES.renewal).toMatch(/renews automatically/i);
    expect(CHECKOUT_DISCLOSURES.renewal).toMatch(/until you cancel/i);
  });

  it('states that cancelling keeps access to the end of the paid period', () => {
    expect(CHECKOUT_DISCLOSURES.cancellation).toMatch(/cancel at any time/i);
    expect(CHECKOUT_DISCLOSURES.cancellation).toMatch(/already paid for/i);
  });

  it('states that cancelling does not delete anything', () => {
    expect(CHECKOUT_DISCLOSURES.dataOnCancellation).toMatch(/never deletes/i);
  });

  it('names the seller and the processor in the seller copy', () => {
    expect(CHECKOUT_DISCLOSURES.seller).toContain(SELLER_OF_RECORD.legalName);
    expect(CHECKOUT_DISCLOSURES.seller).toContain(SELLER_OF_RECORD.processorName);
    expect(CHECKOUT_DISCLOSURES.statement).toContain(SELLER_OF_RECORD.statementDescriptor);
  });

  it('says plainly that the refund decision is ours, and promises no outcome', () => {
    // Under a gateway the decision is ours. Saying so is required; promising a
    // result is not, and would be a promise we might not keep.
    expect(CHECKOUT_DISCLOSURES.refunds).toMatch(/we decide/i);
    expect(CHECKOUT_DISCLOSURES.refunds).not.toMatch(/guarantee|always refund|full refund/i);
  });

  it('never claims tax is added after the price shown', () => {
    expect(CHECKOUT_DISCLOSURES.tax).toMatch(/never added afterwards/i);
  });

  it('makes no prohibited claim', () => {
    const all = [
      ...Object.values(CHECKOUT_DISCLOSURES),
      ...Object.values(BILLING_PAGE_DISCLOSURES),
    ]
      .join(' ')
      .toLowerCase();

    for (const claim of PROHIBITED_CLAIMS) {
      expect(all, `prohibited claim: ${claim}`).not.toContain(claim);
    }
  });

  it('uses no urgency or scarcity language', () => {
    const all = [
      ...Object.values(CHECKOUT_DISCLOSURES),
      ...Object.values(BILLING_PAGE_DISCLOSURES),
    ].join(' ');

    expect(all).not.toMatch(/act now|hurry|limited time|only \d+ left|expires soon/i);
  });
});

describe('operator identity', () => {
  it('records that the operator is not a registered entity', () => {
    // Trading as an individual is lawful. The point of recording it is that
    // the Terms must name a real party either way.
    expect(OPERATOR.registeredEntity).toBe(false);
    expect(OPERATOR.countryOfEstablishment).toBe('IN');
  });

  it('leaves the legal name null rather than shipping a placeholder', () => {
    // A plausible-looking placeholder is worse than an obvious gap: it can
    // ship. Null forces the completeness check below to fail loudly.
    expect(OPERATOR.legalName).toBeNull();
  });

  it('reports the identity as incomplete until it is filled in', () => {
    // LEGAL_REVIEW_REQUIRED. A subscription is a contract and a contract needs
    // a named party. This must be true before taking a payment.
    expect(operatorIdentityComplete()).toBe(false);
  });
});
