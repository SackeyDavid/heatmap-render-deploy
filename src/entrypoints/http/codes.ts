// Stable error codes the HTTP layer can send. The list is mirrored in docs/error-codes.json, which the merchant screen's
// copy table is checked against (test/http/codes.test.ts here, ui/test/error-codes.test.ts there). Add a code in all places.

/** `error.code` values POST /v1/requests can send with status 400. */
export const POST_400_CODES = [
  "invalid-request", // body is not readable JSON or has the wrong shape
  "invalid-prompt",
  "invalid-page-addresses",
  "invalid-public-key",
  "private-key-pattern",
  "invalid-saved-pages",
  "saved-page-too-large",
  "invalid-email",
  "email-required",
  "invalid-operation",
  "invalid-partner-destination",
  "invalid-approval", // POST /v1/requests/:id/approve: the approval is missing or not a usable interpretation
] as const;

/** Every other `error.code` the service can send (any route). */
export const OTHER_ERROR_CODES = [
  "unauthenticated", // 401
  "wrong-environment", // 403
  "not-found", // 404
  "not-awaiting-approval", // 409: the request is not waiting for an approval (already approved, finished or failed)
  "method-not-allowed", // 405
  "payload-too-large", // 413
  "unsupported-media-type", // 415
  "rate-limited", // 429
  "cap-open-requests", // 429
  "internal", // 500
] as const;

/** `code` on a failed `GET /v1/requests/:id`. */
export const FAILED_CODES = [
  "validate-failed",
  "inspect-failed",
  "confirm-failed",
  "reader-unavailable", // the server-side reader could not read the words; a client may read them itself and send again
  "generate-failed",
  "qa-failed",
  "publish-failed",
  "verify-failed",
  "notify-failed",
  "internal",
] as const;

export type Post400Code = (typeof POST_400_CODES)[number];
export type FailedCode = (typeof FAILED_CODES)[number];

/** Every code a client can receive, de-duplicated. */
export const ALL_CODES: readonly string[] = [...new Set<string>([...POST_400_CODES, ...OTHER_ERROR_CODES, ...FAILED_CODES])];
