import { MAX_SAVED_PAGE_BYTES } from "../../domain/page-limits.ts";
import { isPlainEmailAddress } from "../../domain/email-address.ts";
import type { Post400Code } from "./codes.ts";
import { MSG } from "./messages.ts";
import { MAX_FILE_NAME_CHARS, savedPageFileName } from "./pages.ts";
import { resolveRequestOperation, type ResolvedHttpOperations } from "./operations.ts";

export const MAX_PAGE_URLS = 10;
const MAX_URL_CHARS = 2048;

/** The transport-level facts of a request. Operation-specific fields stay in `body` for the operation's own mapper. */
export interface ParsedRequest {
  operation: string;
  prompt: string;
  pageUrls: string[];
  savedPages: { url: string; html: string }[];
  notifyEmail?: string;
  body: Record<string, unknown>;
}

export type ParseResult = { ok: true; value: ParsedRequest } | { ok: false; code: Post400Code; message: string };

const bad = (code: Post400Code, message: string): ParseResult => ({ ok: false, code, message });

/** Returns a normalised http(s) URL string, or an error message key. */
function checkUrl(raw: unknown): { url: string } | { error: "pageUrls" | "pageUrlLong" } {
  if (typeof raw !== "string" || raw.length === 0) return { error: "pageUrls" };
  if (raw.length > MAX_URL_CHARS) return { error: "pageUrlLong" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "pageUrls" };
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return { error: "pageUrls" };
  if (savedPageFileName(u.href).length > MAX_FILE_NAME_CHARS) return { error: "pageUrlLong" };
  return { url: u.href };
}

/**
 * Validates what the transport itself must guarantee (sizes, URL schemes, email shape, which operation). What an
 * operation needs beyond that (its own fields, key rules) is checked by that operation's request mapper.
 * Messages are plain language; the body's siteId (if any) is never read.
 */
export function parseRequestBody(body: unknown, ops: ResolvedHttpOperations): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return bad("invalid-request", MSG.generic);
  const b = body as Record<string, unknown>;

  const resolved = resolveRequestOperation(b, ops);
  if (!resolved.ok) return bad("invalid-operation", resolved.message);

  if (typeof b.prompt !== "string" || b.prompt.trim().length < 10 || b.prompt.length > 4000) return bad("invalid-prompt", MSG.prompt);

  if (!Array.isArray(b.pageUrls) || b.pageUrls.length < 1 || b.pageUrls.length > MAX_PAGE_URLS) return bad("invalid-page-addresses", MSG.pageUrls);
  const pageUrls: string[] = [];
  for (const raw of b.pageUrls) {
    const r = checkUrl(raw);
    if ("error" in r) return bad("invalid-page-addresses", MSG[r.error]);
    pageUrls.push(r.url);
  }

  const savedPages: { url: string; html: string }[] = [];
  if (b.savedPages !== undefined) {
    if (!Array.isArray(b.savedPages) || b.savedPages.length > MAX_PAGE_URLS) return bad("invalid-saved-pages", MSG.savedPages);
    for (const sp of b.savedPages) {
      if (typeof sp !== "object" || sp === null) return bad("invalid-saved-pages", MSG.savedPages);
      const { url, html } = sp as Record<string, unknown>;
      const r = checkUrl(url);
      if ("error" in r) return bad("invalid-saved-pages", MSG[r.error]);
      if (typeof html !== "string" || html.length === 0) return bad("invalid-saved-pages", MSG.savedPages);
      if (Buffer.byteLength(html, "utf8") > MAX_SAVED_PAGE_BYTES) return bad("saved-page-too-large", MSG.savedPageTooLarge);
      savedPages.push({ url: r.url, html });
    }
  }

  let notifyEmail: string | undefined;
  if (b.notifyEmail !== undefined) {
    if (typeof b.notifyEmail !== "string" || !isPlainEmailAddress(b.notifyEmail)) return bad("invalid-email", MSG.email);
    notifyEmail = b.notifyEmail;
  }

  return { ok: true, value: { operation: resolved.operation, prompt: b.prompt, pageUrls, savedPages, ...(notifyEmail ? { notifyEmail } : {}), body: b } };
}
