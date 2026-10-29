// Pure HS256 JWT sign/verify for the Heatmap session stand-in. node:crypto only, no JWT library.
// Follows the token contract in docs/BUILD-CONTRACTS.md. Never logs anything.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SUB_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SITE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const MIN_SECRET_LENGTH = 32;
export const CLOCK_SKEW_SECONDS = 60;
export const MAX_LIFETIME_SECONDS = 24 * 60 * 60;
export const ISSUERS = ["heatmap", "heatmap-local"] as const;

export interface TokenClaims {
  iss: string;
  sub: string;
  siteId: string;
  email?: string;
  /** The website as the person typed it (for display only; siteId is the folder name). */
  label?: string;
  iat: number;
  exp: number;
}

export type VerifyResult = { ok: true; claims: TokenClaims } | { ok: false; reason: string };

const b64url = (buf: Buffer): string => buf.toString("base64url");
const mac = (data: string, secret: string): Buffer => createHmac("sha256", secret).update(data).digest();

function assertSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`token secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
}

export function signToken(claims: TokenClaims, secret: string): string {
  assertSecret(secret);
  const head = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(claims)));
  return `${head}.${body}.${b64url(mac(`${head}.${body}`, secret))}`;
}

export function verifyToken(token: string, secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): VerifyResult {
  try {
    assertSecret(secret);
  } catch {
    return { ok: false, reason: "bad secret" };
  }
  if (typeof token !== "string") return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof header !== "object" || header === null || (header as { alg?: unknown }).alg !== "HS256") return { ok: false, reason: "alg must be HS256" };
  const given = Buffer.from(s, "base64url");
  const expected = mac(`${h}.${p}`, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad signature" };
  if (typeof claims !== "object" || claims === null) return { ok: false, reason: "malformed" };
  const c = claims as Record<string, unknown>;
  if (typeof c.iss !== "string" || !(ISSUERS as readonly string[]).includes(c.iss)) return { ok: false, reason: "bad iss" };
  if (typeof c.sub !== "string" || !SUB_RE.test(c.sub)) return { ok: false, reason: "bad sub" };
  if (typeof c.siteId !== "string" || !SITE_ID_RE.test(c.siteId)) return { ok: false, reason: "bad siteId" };
  if (c.email !== undefined && typeof c.email !== "string") return { ok: false, reason: "bad email" };
  if (typeof c.iat !== "number" || typeof c.exp !== "number" || !Number.isFinite(c.iat) || !Number.isFinite(c.exp)) return { ok: false, reason: "iat and exp required" };
  if (c.exp <= nowSeconds - CLOCK_SKEW_SECONDS) return { ok: false, reason: "expired" };
  if (c.iat > nowSeconds + CLOCK_SKEW_SECONDS) return { ok: false, reason: "issued in the future" };
  if (c.exp - c.iat > MAX_LIFETIME_SECONDS) return { ok: false, reason: "lifetime too long" };
  return { ok: true, claims: c as unknown as TokenClaims };
}
