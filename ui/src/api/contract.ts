// Mirrors "HTTP API contract" in docs/BUILD-CONTRACTS.md. The UI never sends siteId:
// the server takes it from the sign-in token.

export interface SavedPage {
  url: string;
  html: string;
}

export interface CreateRequestBody {
  /** Which partner pipeline to run; server must allow it (HEATMAP_HTTP_ALLOWED_OPERATIONS). */
  operation?: string;
  prompt: string; // 10..4000
  pageUrls: string[]; // 1..10, http/https
  /** Klaviyo: 6 letters and numbers. Omit for generic.heatmap-events. */
  publicKey?: string;
  /** generic.heatmap-events: lowercase slug for _fireCustomEvent destination. */
  partnerDestination?: string;
  savedPages?: SavedPage[]; // max 10, each <= 2_000_000 characters
  notifyEmail?: string;
  /** What the in-browser helper (a model) read from the prompt. The server checks it against the page; the merchant approves it. */
  interpretation?: unknown;
  /** Optional short tag the server adds in brackets to every event name (test sites); omitted for merchants. */
  eventTag?: string;
}

export interface CreateRequestResponse {
  requestId: string;
  status: 'queued';
}

/**
 * queued -> interpreting (we read the request and check it against the page) -> needs-confirmation (we wait for the merchant to approve
 * what we understood) -> running (approved; the code is made and tested) -> succeeded | failed.
 */
export type RequestStatus = 'queued' | 'interpreting' | 'needs-confirmation' | 'running' | 'succeeded' | 'failed';

/** "Here is what we understood", built by the server from the checked interpretation and the real page. */
export interface Understanding {
  version: 1;
  confidence: 'high' | 'medium' | 'low';
  needsAttention: boolean;
  tracked: { index: number; kind: 'click' | 'scroll' | 'faq'; title: string; event: string; control?: string; /** The merchant's own words this came from. */ words?: string }[];
  notTracked: string[];
  questions: UnderstandingQuestion[];
  notes: string[];
}

export interface UnderstandingQuestion {
  id: string;
  prompt: string;
  behaviourIndex: number;
  options: { id: string; label: string; set: { target?: string; heading?: string } }[];
}

export interface ApproveRequestBody {
  /** The interpretation the merchant approved (answers to the questions applied). The server checks it again against the page. */
  interpretation: unknown;
}

export interface ApproveRequestResponse {
  requestId: string;
  status: 'approved';
}

export type ConfirmationDelivery = 'email' | 'console';

export interface RequestView {
  requestId: string;
  status: RequestStatus;
  message: string;
  scriptUrl?: string;
  testTags?: string[];
  /** Parts of the request the result does not cover, as plain sentences (at most about 8). Optional: older servers do not send it. */
  leftOut?: string[];
  updatedAt: string;
  /** Local stack: notifier is console-only (no real mail). */
  confirmationDelivery?: ConfirmationDelivery;
  /** Not in the contract. Tolerated if the server adds a stable code to failed results. */
  code?: string;
  /** With status needs-confirmation: what we understood, and the interpretation it describes (sent back with the approval). */
  understanding?: Understanding;
  interpretation?: unknown;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export const LIMITS = {
  promptMin: 10,
  promptMax: 4000,
  pages: 10,
  savedPageChars: 2_000_000,
} as const;

export const TERMINAL: readonly RequestStatus[] = ['succeeded', 'failed'];
/** Polling stops here and waits for the merchant. */
export const PAUSED: readonly RequestStatus[] = ['needs-confirmation'];
