// HS256 bearer-token verification with node:crypto only (no JWT library). Contract: docs/BUILD-CONTRACTS.md.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SKEW_SECONDS = 60;
export const MAX_LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_TOKEN_CHARS = 4096;

const B64URL = /^[A-Za-z0-9_-]+$/;
const SUB_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SITE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export interface TokenClaims {
  iss: string;
  sub: string;
  siteId: string;
  email?: string;
  iat: number;
  exp: number;
}

export type TokenFailure = "malformed" | "unsupported_alg" | "bad_signature" | "bad_claims" | "expired" | "not_yet_valid" | "lifetime_too_long" | "issuer_not_accepted";

export type VerifyResult = { ok: true; claims: TokenClaims } | { ok: false; reason: TokenFailure };

const fail = (reason: TokenFailure): VerifyResult => ({ ok: false, reason });

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function verifyToken(
  token: string,
  opts: { secret: string; acceptedIssuers: readonly string[]; nowSeconds: number },
): VerifyResult {
  if (token.length === 0 || token.length > MAX_TOKEN_CHARS) return fail("malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => p.length > 0 && B64URL.test(p))) return fail("malformed");
  const [h, p, s] = parts as [string, string, string];

  const header = decodeJson(h);
  if (!header) return fail("malformed");
  // Exact match only: rejects "none", "HS384", "RS256", "hs256" and anything else.
  if (header.alg !== "HS256") return fail("unsupported_alg");

  // Signature first; claims are not trusted (or even interpreted) before it checks out.
  const expected = createHmac("sha256", opts.secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return fail("bad_signature");

  const c = decodeJson(p);
  if (!c) return fail("malformed");
  const { iss, sub, siteId, email, iat, exp } = c;
  if (typeof iss !== "string" || typeof sub !== "string" || !SUB_RE.test(sub)) return fail("bad_claims");
  if (typeof siteId !== "string" || !SITE_ID_RE.test(siteId)) return fail("bad_claims");
  if (email !== undefined && (typeof email !== "string" || !EMAIL_RE.test(email))) return fail("bad_claims");
  if (typeof iat !== "number" || typeof exp !== "number" || !Number.isFinite(iat) || !Number.isFinite(exp)) return fail("bad_claims");
  if (!opts.acceptedIssuers.includes(iss)) return fail("issuer_not_accepted");
  if (exp <= iat) return fail("bad_claims");
  if (exp - iat > MAX_LIFETIME_SECONDS) return fail("lifetime_too_long");
  if (iat > opts.nowSeconds + SKEW_SECONDS) return fail("not_yet_valid");
  if (exp + SKEW_SECONDS <= opts.nowSeconds) return fail("expired");
  return { ok: true, claims: { iss, sub, siteId, ...(email !== undefined ? { email } : {}), iat, exp } };
}

/** Returns the token from an `Authorization: Bearer <token>` header value, or null. */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}
