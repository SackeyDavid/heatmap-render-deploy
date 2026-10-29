import { withHttps } from './extract-urls';
import { LIMITS, type CreateRequestBody } from '../api/contract';
import { fill, screens } from '../copy';
import { parseModelInterpretation, type ModelInterpretation } from '../model/interpretation';
import {
  OPERATION_GENERIC,
  OPERATION_KLAVIYO,
  type MerchantOperation,
} from '../partners/catalog';

export interface FormValues {
  operation: MerchantOperation;
  prompt: string;
  pageUrls: string[]; // one entry per address box (may include empty ones)
  savedHtml: string[]; // same length/order as pageUrls
  publicKey: string;
  partnerDestination: string;
  notifyEmail: string;
  /** Local testing: paste mock helper JSON from the Model Lab (developer section). */
  mockInterpretationJson: string;
  sendMockInterpretation: boolean;
}

export interface FieldError {
  /** DOM id of the field to focus. */
  fieldId: string;
  /** Plain name of the field, for the summary. */
  label: string;
  message: string;
}

export const FIELD_IDS = {
  prompt: 'field-prompt',
  partner: 'field-partner',
  key: 'field-key',
  partnerDestination: 'field-partner-destination',
  email: 'field-email',
  page: (i: number) => `field-page-${i}`,
  saved: (i: number) => `field-saved-${i}`,
  mockInterpretation: 'field-mock-interpretation',
};

const PARTNER_DESTINATION_RE = /^[a-z][a-z0-9-]{1,31}$/;

export function emptyValues(defaultOperation: MerchantOperation = OPERATION_KLAVIYO): FormValues {
  return {
    operation: defaultOperation,
    prompt: '',
    pageUrls: [''],
    savedHtml: [''],
    publicKey: '',
    partnerDestination: 'custom-partner',
    notifyEmail: '',
    mockInterpretationJson: '',
    sendMockInterpretation: false,
  };
}

/** Parses optional mock interpretation for local Track 2 testing; returns null when off or invalid. */
export function parseMockInterpretation(v: FormValues): ModelInterpretation | null {
  if (!v.sendMockInterpretation) return null;
  const text = v.mockInterpretationJson.trim();
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as unknown;
    return parseModelInterpretation(raw);
  } catch {
    return null;
  }
}

function isWebAddress(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export function validate(v: FormValues): FieldError[] {
  const errors: FieldError[] = [];
  const t = screens.validation;
  const f = screens.fields;

  const prompt = v.prompt.trim();
  if (prompt.length < LIMITS.promptMin) {
    errors.push({ fieldId: FIELD_IDS.prompt, label: f.prompt, message: t.promptShort });
  } else if (prompt.length > LIMITS.promptMax) {
    errors.push({ fieldId: FIELD_IDS.prompt, label: f.prompt, message: t.promptLong });
  }

  const filled = v.pageUrls.map((u, i) => ({ url: withHttps(u), i })).filter((p) => p.url !== '');
  if (filled.length === 0) {
    errors.push({ fieldId: FIELD_IDS.page(0), label: f.pageUrls, message: t.pageMissing });
  }
  const seen = new Set<string>();
  for (const p of filled) {
    const label = fill(f.pageUrl, { n: p.i + 1 });
    if (!isWebAddress(p.url)) {
      errors.push({ fieldId: FIELD_IDS.page(p.i), label, message: t.pageInvalid });
    } else if (seen.has(p.url)) {
      errors.push({ fieldId: FIELD_IDS.page(p.i), label, message: t.pageDuplicate });
    }
    seen.add(p.url);
  }

  if (v.operation === OPERATION_KLAVIYO) {
    const key = v.publicKey.trim();
    if (/^pk_/i.test(key) || key.length > 20) {
      errors.push({ fieldId: FIELD_IDS.key, label: f.publicKey, message: t.keyPrivate });
    } else if (!/^[A-Za-z0-9]{6}$/.test(key)) {
      errors.push({ fieldId: FIELD_IDS.key, label: f.publicKey, message: t.keyInvalid });
    }
  } else if (v.operation === OPERATION_GENERIC) {
    const dest = v.partnerDestination.trim();
    if (!PARTNER_DESTINATION_RE.test(dest)) {
      errors.push({
        fieldId: FIELD_IDS.partnerDestination,
        label: f.partnerDestination,
        message: t.partnerDestinationInvalid,
      });
    }
  }

  const email = v.notifyEmail.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ fieldId: FIELD_IDS.email, label: f.notifyEmail, message: t.emailInvalid });
  }

  v.savedHtml.forEach((html, i) => {
    if (html.length > LIMITS.savedPageChars) {
      errors.push({
        fieldId: FIELD_IDS.saved(i),
        label: fill(f.savedPage, { n: i + 1 }),
        message: t.savedTooBig,
      });
    }
  });

  if (v.sendMockInterpretation) {
    const text = v.mockInterpretationJson.trim();
    const label = f.mockInterpretation;
    if (!text) {
      errors.push({ fieldId: FIELD_IDS.mockInterpretation, label, message: t.mockInterpretationEmpty });
    } else {
      try {
        const raw = JSON.parse(text) as unknown;
        if (!parseModelInterpretation(raw)) {
          errors.push({ fieldId: FIELD_IDS.mockInterpretation, label, message: t.mockInterpretationInvalidShape });
        }
      } catch {
        errors.push({ fieldId: FIELD_IDS.mockInterpretation, label, message: t.mockInterpretationInvalidJson });
      }
    }
  }

  return errors;
}

/**
 * Builds the exact POST /v1/requests body from the contract.
 * siteId is NEVER included: the server takes it from the sign-in.
 * `interpretation` is the extension point for the future helper (see model/provider.ts); omitted when absent.
 */
export function buildRequestBody(v: FormValues, interpretation?: ModelInterpretation | null): CreateRequestBody {
  const pages = v.pageUrls.map((u, i) => ({ url: withHttps(u), html: v.savedHtml[i] ?? '' })).filter((p) => p.url !== '');
  const body: CreateRequestBody = {
    operation: v.operation,
    prompt: v.prompt.trim(),
    pageUrls: pages.map((p) => p.url),
  };
  if (v.operation === OPERATION_KLAVIYO) {
    body.publicKey = v.publicKey.trim();
  } else {
    body.partnerDestination = v.partnerDestination.trim();
  }
  const saved = pages.filter((p) => p.html.trim() !== '').map((p) => ({ url: p.url, html: p.html }));
  if (saved.length > 0) body.savedPages = saved;
  const email = v.notifyEmail.trim();
  if (email) body.notifyEmail = email;
  if (interpretation) body.interpretation = interpretation;
  return body;
}

/** Builds POST body including optional mock interpretation from the form (local dev). */
export function buildRequestBodyFromForm(v: FormValues): CreateRequestBody {
  return buildRequestBodyForSubmit(v, null);
}

/**
 * Mock paste (developer section) wins over live helper output.
 * Server re-validates any interpretation we send.
 */
export function buildRequestBodyForSubmit(
  v: FormValues,
  helperInterpretation?: ModelInterpretation | null,
): CreateRequestBody {
  const mock = parseMockInterpretation(v);
  if (mock) return buildRequestBody(v, mock);
  return buildRequestBody(v, helperInterpretation ?? null);
}
