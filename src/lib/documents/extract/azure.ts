/**
 * Azure Document Intelligence reader, prebuilt invoice model.
 *
 * Used for photographs and scans, where there is no text layer to read. Also
 * handles PDFs without one. Purpose-built for invoices: it returns the fields
 * a bill has (totals, dates, line items) with a per-field confidence, which is
 * exactly what the review step wants.
 *
 * Why this and not the model: a vision model can describe a photo of a bill;
 * this returns a structured table with confidences the customer can see. And
 * its free tier (500 pages/month at the time of writing) is a proper Azure
 * service with a data processing agreement, not a shared research endpoint.
 *
 * Plain REST, no SDK: the API is two calls and the SDK is 4MB of bundle.
 *
 * Configuration: OCR_PROVIDER=azure, AZURE_DI_ENDPOINT, AZURE_DI_KEY. Without
 * them this reader is simply not offered and photos fail with a clear note.
 */

import {
  type DraftLine,
  type DraftMoney,
  type DraftText,
  type ExtractionDraft,
  confidenceFromScore,
  lowestConfidence,
  parseDateToIso,
} from '@/domain/documents/draft';
import { log } from '@/lib/logging';
import type { DocumentReader, ReaderInput } from './port';

export const AZURE_ENGINE_VERSION = 'prebuilt-invoice/2024-11-30';

const API_VERSION = '2024-11-30';
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 50_000;

/** The subset of Azure's response we read. Tolerant: every field optional. */
interface AzureField {
  type?: string;
  content?: string;
  confidence?: number;
  valueString?: string;
  valueDate?: string;
  valueNumber?: number;
  valueCurrency?: { amount?: number; currencyCode?: string };
  valueArray?: { valueObject?: Record<string, AzureField> }[];
}

export interface AzureAnalyzeResult {
  status?: string;
  analyzeResult?: {
    content?: string;
    pages?: unknown[];
    documents?: { fields?: Record<string, AzureField> }[];
  };
  error?: { code?: string; message?: string };
}

export interface AzureConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

function moneyField(f: AzureField | undefined): DraftMoney | null {
  const amount = f?.valueCurrency?.amount;
  if (amount === undefined || !Number.isFinite(amount)) return null;
  return { amountCents: Math.round(amount * 100), confidence: confidenceFromScore(f?.confidence) };
}

function textField(f: AzureField | undefined): DraftText | null {
  const v = (f?.valueString ?? f?.content)?.trim();
  return v ? { value: v, confidence: confidenceFromScore(f?.confidence) } : null;
}

function dateField(f: AzureField | undefined): DraftText | null {
  const iso = parseDateToIso(f?.valueDate ?? f?.content);
  return iso ? { value: iso, confidence: confidenceFromScore(f?.confidence) } : null;
}

/**
 * Map an Azure invoice result onto our draft. Exported so it can be tested
 * against a recorded response without a network.
 */
export function mapAzureInvoice(
  result: AzureAnalyzeResult,
  pageCount: number | null,
): ExtractionDraft {
  const fields = result.analyzeResult?.documents?.[0]?.fields ?? {};
  const notes: string[] = [];

  const lineItems: DraftLine[] = (fields.Items?.valueArray ?? []).map((row) => {
    const o = row.valueObject ?? {};
    const amount = moneyField(o.Amount);
    const qty = o.Quantity?.valueNumber;
    const date = parseDateToIso(o.Date?.valueDate ?? o.Date?.content);
    return {
      description: (o.Description?.valueString ?? o.Description?.content ?? '').trim() || 'Line item',
      amountCents: amount?.amountCents ?? null,
      ...(o.ProductCode?.valueString ? { code: o.ProductCode.valueString.trim() } : {}),
      ...(qty !== undefined && Number.isFinite(qty) ? { quantity: qty } : {}),
      ...(date ? { serviceDate: date } : {}),
      confidence: lowestConfidence([
        confidenceFromScore(o.Description?.confidence),
        amount?.confidence,
      ]),
    };
  });

  const currencyCode =
    fields.InvoiceTotal?.valueCurrency?.currencyCode ??
    fields.AmountDue?.valueCurrency?.currencyCode ??
    fields.SubTotal?.valueCurrency?.currencyCode ??
    null;
  const currency = currencyCode === 'USD' || currencyCode === 'CAD' ? currencyCode : null;

  const subtotal = moneyField(fields.SubTotal);
  const total = moneyField(fields.InvoiceTotal);
  const amountDue = moneyField(fields.AmountDue);
  const previousBalance = moneyField(fields.PreviousUnpaidBalance);

  const blank = lineItems.filter((l) => l.amountCents === null).length;
  if (blank > 0) notes.push(`${blank} line item${blank === 1 ? '' : 's'} had no readable amount.`);
  if (lineItems.length === 0) notes.push('No individual charges were found.');
  if (!total && !amountDue && !subtotal) notes.push('No total was found.');
  notes.push('Every figure below was read from the image. Check each one against your document.');

  const overall = lowestConfidence([
    ...lineItems.map((l) => l.confidence),
    subtotal?.confidence,
    total?.confidence,
    amountDue?.confidence,
  ]);

  return {
    engine: 'azure-invoice',
    engineVersion: AZURE_ENGINE_VERSION,
    currency,
    lineItems,
    subtotal,
    total,
    amountDue,
    // The invoice model has no "insurance paid" concept. Left for the customer.
    insurancePaid: null,
    adjustments: null,
    previousBalance,
    statementDate: dateField(fields.InvoiceDate),
    providerName: textField(fields.VendorName),
    accountReference: textField(fields.InvoiceId) ?? textField(fields.CustomerId),
    pageCount,
    overallConfidence: overall,
    notes,
  };
}

export function createAzureReader(config: AzureConfig): DocumentReader {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const base = config.endpoint.replace(/\/$/, '');

  return {
    name: 'azure-invoice',
    version: AZURE_ENGINE_VERSION,

    accepts(): boolean {
      // Handles every allowed type, including PDFs without a text layer.
      return true;
    },

    async read(input: ReaderInput): Promise<ExtractionDraft> {
      const submit = await fetchImpl(
        `${base}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=${API_VERSION}`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': config.apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ base64Source: Buffer.from(input.bytes).toString('base64') }),
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (submit.status !== 202) {
        // Status only. The body can echo request details.
        throw new Error(`Azure Document Intelligence returned ${submit.status} on submit`);
      }

      const location = submit.headers.get('operation-location');
      if (location === null) throw new Error('Azure Document Intelligence returned no operation location');

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let result: AzureAnalyzeResult | null = null;

      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const poll = await fetchImpl(location, {
          headers: { 'Ocp-Apim-Subscription-Key': config.apiKey },
          signal: AbortSignal.timeout(20_000),
        });
        if (!poll.ok) throw new Error(`Azure Document Intelligence returned ${poll.status} on poll`);
        const body = (await poll.json()) as AzureAnalyzeResult;
        if (body.status === 'succeeded') {
          result = body;
          break;
        }
        if (body.status === 'failed') {
          log.warn('azure analysis failed', {
            route: 'documents.azure',
            errorClass: body.error?.code ?? 'unknown',
          });
          throw new Error('Azure Document Intelligence analysis failed');
        }
      }

      if (result === null) throw new Error('Azure Document Intelligence timed out');

      return mapAzureInvoice(result, result.analyzeResult?.pages?.length ?? null);
    },
  };
}
