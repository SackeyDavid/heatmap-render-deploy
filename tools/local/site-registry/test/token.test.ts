import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { signToken, verifyToken, type TokenClaims } from "../token.ts";

const secret = randomBytes(32).toString("hex");
const now = 1_800_000_000;
const claims: TokenClaims = { iss: "heatmap-local", sub: "user_1", siteId: "site-1", email: "a@b.test", iat: now, exp: now + 3600 };

/** Independent minimal verifier, written as the HTTP agent's would be (no shared code with token.ts). */
function independentVerify(token: string, key: string, at: number): Record<string, unknown> | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  if (JSON.parse(Buffer.from(h, "base64url").toString()).alg !== "HS256") return null;
  const want = createHmac("sha256", key).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const c = JSON.parse(Buffer.from(p, "base64url").toString());
  if (c.exp + 60 <= at) return null;
  return c;
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

test("signed token verifies in an independent verifier and in verifyToken", () => {
  const t = signToken(claims, secret);
  assert.deepEqual(independentVerify(t, secret, now), { ...claims });
  const r = verifyToken(t, secret, now);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.claims, claims);
});

test("independently built HS256 token verifies here", () => {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(claims);
  const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  assert.ok(verifyToken(`${h}.${p}.${sig}`, secret, now).ok);
});

test("alg none is rejected", () => {
  const t = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
  assert.equal(verifyToken(t, secret, now).ok, false);
  const t2 = `${b64({ alg: "none" })}.${b64(claims)}.abc`;
  assert.equal(verifyToken(t2, secret, now).ok, false);
});

test("alg HS512 label is rejected even with a valid-looking mac", () => {
  const h = b64({ alg: "HS512" }), p = b64(claims);
  const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  assert.equal(verifyToken(`${h}.${p}.${sig}`, secret, now).ok, false);
});

test("tampered payload and wrong secret are rejected", () => {
  const [h, , s] = signToken(claims, secret).split(".");
  const forged = `${h}.${b64({ ...claims, siteId: "other-site" })}.${s}`;
  assert.equal(verifyToken(forged, secret, now).ok, false);
  assert.equal(verifyToken(signToken(claims, secret), randomBytes(32).toString("hex"), now).ok, false);
});

test("expiry with 60 s skew", () => {
  const t = signToken(claims, secret);
  assert.ok(verifyToken(t, secret, claims.exp + 59).ok);
  const r = verifyToken(t, secret, claims.exp + 61);
  assert.ok(!r.ok && r.reason === "expired");
});

test("contract claim rules", () => {
  const bad = (c: Partial<TokenClaims>) => verifyToken(signToken({ ...claims, ...c }, secret), secret, now).ok;
  assert.equal(bad({ iss: "evil" }), false);
  assert.equal(bad({ siteId: "a.b" }), false);
  assert.equal(bad({ siteId: "-lead" }), false);
  assert.equal(bad({ sub: "has space" }), false);
  assert.equal(bad({ exp: now + 25 * 3600 }), false);
  assert.equal(bad({ iat: now + 3600, exp: now + 7200 }), false);
  assert.equal(bad({ iss: "heatmap" }), true);
});

test("short secrets are refused for signing and verifying; garbage tokens fail closed", () => {
  assert.throws(() => signToken(claims, "short"));
  assert.equal(verifyToken(signToken(claims, secret), "short", now).ok, false);
  for (const g of ["", "a.b", "a.b.c.d", "...", "not a token"]) assert.equal(verifyToken(g, secret, now).ok, false);
});
