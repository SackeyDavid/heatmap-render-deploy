import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import { configFromEnv, createAuthServer, listenLoopback, type Config } from "../server.ts";
import { verifyToken } from "../token.ts";

const secret = randomBytes(32).toString("hex");
let dir: string, server: Server, base: string, clock: number;
const logs: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "site-registry-"));
  clock = Date.now();
  const cfg: Config = { ...configFromEnv({ HEATMAP_TOKEN_SECRET: secret }), registryFile: join(dir, "sites.json"), port: 0, log: (l) => logs.push(l), now: () => clock, uiBase: "http://127.0.0.1:5173" };
  server = createAuthServer(cfg);
  base = `http://127.0.0.1:${await listenLoopback(server, 0)}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const codeFrom = (line: string) => line.split("/go/")[1]!;
const codeFromSignInHtml = (html: string) => {
  const m = html.match(/href="[^"]*\/go\/([A-Za-z0-9_-]+)"/);
  assert.ok(m, "expected /go/ link in sign-in HTML");
  return m[1]!;
};
const get = (p: string) => fetch(base + p, { redirect: "manual" });

test("startup guards: production mode, missing or short secret", () => {
  assert.throws(() => configFromEnv({ HEATMAP_MODE: "production", HEATMAP_TOKEN_SECRET: secret }), /production/);
  assert.throws(() => configFromEnv({}), /HEATMAP_TOKEN_SECRET/);
  assert.throws(() => configFromEnv({ HEATMAP_TOKEN_SECRET: "short" }), /HEATMAP_TOKEN_SECRET/);
  assert.equal(configFromEnv({ HEATMAP_MODE: "development", HEATMAP_TOKEN_SECRET: secret }).tokenTtlSeconds, 8 * 3600);
});

test("binds to loopback only", () => {
  const a = server.address();
  assert.ok(a && typeof a === "object" && a.address === "127.0.0.1");
});

test("registry is seeded once with one example site and listed without secrets", async () => {
  const r = await get("/api/sites");
  const body = (await r.json()) as { sites: { siteId: string }[] };
  assert.equal(body.sites.length, 1);
  assert.ok(!JSON.stringify(body).includes(secret));
});

test("sign-in flow: link on page and in log, single use, token verifies, redirect to UI", async () => {
  const r = await get("/signin?site=example-site");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Continue sign-in/);
  const line = logs.at(-1)!;
  assert.ok(!line.includes(secret));
  const code = codeFromSignInHtml(html);
  assert.equal(code, codeFrom(line));
  const go = await get(`/go/${code}`);
  assert.equal(go.status, 302);
  const loc = new URL(go.headers.get("location")!);
  assert.equal(loc.origin, "http://127.0.0.1:5173");
  const v = verifyToken(loc.searchParams.get("token")!, secret);
  assert.ok(v.ok && v.claims.siteId === "example-site" && v.claims.iss === "heatmap-local" && v.claims.exp - v.claims.iat === 8 * 3600);
  assert.equal((await get(`/go/${code}`)).status, 410);
});

test("codes expire after 5 minutes", async () => {
  await get("/signin?site=example-site");
  const code = codeFrom(logs.at(-1)!);
  clock += 5 * 60 * 1000 + 1;
  assert.equal((await get(`/go/${code}`)).status, 410);
});

test("unknown site, bad site id and bad code are refused", async () => {
  assert.equal((await get("/signin?site=nope")).status, 404);
  assert.equal((await get("/signin?site=a.b")).status, 404);
  assert.equal((await get("/go/" + "A".repeat(43))).status, 410);
  assert.equal((await get("/go/x")).status, 400);
});

test("POST /api/sites validates and persists; duplicates and bad ids refused", async () => {
  const post = (b: unknown, headers: Record<string, string> = { "content-type": "application/json" }) => fetch(base + "/api/sites", { method: "POST", headers, body: JSON.stringify(b) });
  const ok = await post({ siteId: "shop-2", userId: "u2", userEmail: "u2@example.test", label: "Shop 2" });
  assert.equal(ok.status, 201);
  assert.equal((await post({ siteId: "shop-2", userId: "u2", userEmail: "u2@example.test" })).status, 409);
  assert.equal((await post({ siteId: "bad.id", userId: "u2", userEmail: "u2@example.test" })).status, 400);
  assert.equal((await post({ siteId: "x1", userId: "bad id", userEmail: "u2@example.test" })).status, 400);
  assert.equal((await post({ siteId: "x1", userId: "u", userEmail: "nope" })).status, 400);
  assert.equal((await post({ siteId: "x1", userId: "u", userEmail: "a@b.test" }, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post({ siteId: "x1", userId: "u", userEmail: "a@b.test" }, { "content-type": "application/json", origin: "http://evil.test" })).status, 403);
  assert.ok(readFileSync(join(dir, "sites.json"), "utf8").includes("shop-2"));
  const list = (await (await get("/api/sites")).json()) as { sites: unknown[] };
  assert.equal(list.sites.length, 2);
});

test("non-loopback Host header is rejected", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const port = Number(new URL(base).port);
    const req = httpRequest({ host: "127.0.0.1", port, path: "/api/sites", headers: { host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("nothing logged contains the secret or a JWT", async () => {
  assert.ok(logs.length > 0);
  for (const l of logs) { assert.ok(!l.includes(secret)); assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\./.test(l)); }
});
