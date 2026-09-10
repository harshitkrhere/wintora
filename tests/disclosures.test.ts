/**
 * Commercial disclosures.
 *
 * These strings are representations made to a customer before they pay. Under
 * a Merchant of Record two of them are not optional: who the customer is
 * actually contracting with, and what name will appear on their statement.
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
  it('names the entity the customer actually contracts with', () => {
    expect(SELLER_OF_RECORD.legalName.length).toBeGreaterThan(0);
    expect(SELLER_OF_RECORD.role).toBe('MERCHANT_OF_RECORD');
  });

  it('records that the seller, not us, handles refunds and tax', () => {
    // Both are true of a Merchant of Record, and both change what we may
    // promise a customer. Our refund policy is a reaction to their decision.
    expect(SELLER_OF_RECORD.handlesRefunds).toBe(true);
    expect(SELLER_OF_RECORD.remitsTax).toBe(true);
  });

  it('declares a statement descriptor', () => {
    expect(SELLER_OF_RECORD.statementDescriptor.length).toBeGreaterThan(0);
    // It must not be the bare product name, because the charge is not from us.
    expect(SELLER_OF_RECORD.statementDescriptor.toLowerCase()).toContain('paddle');
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

  it('names the seller in the seller and refund copy', () => {
    expect(CHECKOUT_DISCLOSURES.seller).toContain(SELLER_OF_RECORD.legalName);
    expect(CHECKOUT_DISCLOSURES.refunds).toContain(SELLER_OF_RECORD.legalName);
  });

  it('does not promise a refund outcome we do not control', () => {
    // The decision is the seller's. Saying otherwise would be a promise we
    // cannot keep, which is worse than saying nothing.
    expect(CHECKOUT_DISCLOSURES.refunds).toMatch(/decision is theirs/i);
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
