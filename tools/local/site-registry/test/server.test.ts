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

test("codes expire after 48 hours, and not before", async () => {
  await get("/signin?site=example-site");
  const code = codeFrom(logs.at(-1)!);
  clock += 47 * 3600 * 1000;
  const early = await get("/signin?site=example-site"); // a page view just before the end still gets a link
  assert.match(await early.text(), /Sets up in 2 seconds/);
  clock += 1 * 3600 * 1000 + 1;
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

const save = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(base + "/signin/save", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString() });

test("the sign-in page says Sign in, has a pencil, a Connected badge, and a hidden Save button", async () => {
  const html = await (await get("/signin?site=example-site")).text();
  assert.match(html, /<h1>Sign in<\/h1>/);
  assert.ok(!/local sign-in/i.test(html));
  assert.match(html, /hm-local-auth__pencil/);
  assert.match(html, /Connected/);
  assert.match(html, /Works always<\/li>\s*<li>[\s\S]*Sets up in 2 seconds<\/li>\s*<li>[\s\S]*Secured<\/li>/);
  assert.ok(!/Expires in|Local token/.test(html));
  assert.match(html, /hm-local-auth__actions" data-field hidden/);
  assert.match(html, /data-cancel/);
});

test("saving a new website and email signs the token in for them", async () => {
  const r = await save({ from: "example-site", website: "https://www.Manduu.com/shop", email: "owner@manduu.com" }, { origin: base });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/signin?site=manduu-com&saved=1");
  const html = await (await get("/signin?site=manduu-com&saved=1")).text();
  assert.match(html, /Saved\./);
  const go = await get("/go/" + codeFromSignInHtml(html));
  const token = new URL(go.headers.get("location")!).searchParams.get("token")!;
  const v = verifyToken(token, secret, Math.floor(clock / 1000));
  assert.ok(v.ok, JSON.stringify(v));
  const claims = v.claims;
  assert.equal(claims.siteId, "manduu-com");
  assert.equal(claims.email, "owner@manduu.com");
});

test("saving refuses another website's form post, a bad email and an empty website", async () => {
  assert.equal((await save({ from: "example-site", website: "x.com", email: "a@b.co" }, { origin: "http://evil.example" })).status, 403);
  assert.equal((await save({ from: "example-site", website: "x.com", email: "not an email" })).status, 400);
  assert.equal((await save({ from: "example-site", website: "///", email: "a@b.co" })).status, 400);
  assert.equal((await save({ from: "nope", website: "x.com", email: "a@b.co" })).status, 404);
});

test("saving a website that another site already uses is refused and changes nothing", async () => {
  await fetch(base + "/api/sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: "bob-com", userId: "bob", userEmail: "bob@bob.com" }) });
  const r = await save({ from: "example-site", website: "https://www.Bob.com/shop", email: "eve@evil.test" }, { origin: base });
  assert.equal(r.status, 409);
  const sites = ((await (await get("/api/sites")).json()) as { sites: { siteId: string; userId: string; userEmail: string }[] }).sites;
  assert.deepEqual(sites.find((s) => s.siteId === "bob-com"), { siteId: "bob-com", userId: "bob", userEmail: "bob@bob.com", label: "bob-com" });
});

test("an oversized save is answered with 413, not a dropped connection", async () => {
  const r = await save({ from: "example-site", website: "x.com", email: "a@b.co", pad: "x".repeat(20000) }, { origin: base });
  assert.equal(r.status, 413);
});

test("saving in place answers with JSON and a new link, with no redirect", async () => {
  const r = await fetch(base + "/signin/save", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", origin: base }, body: new URLSearchParams({ from: "manduu-com", website: "manduu.com", email: "kofiahen001+testheatmaptracker@gmail.com" }).toString() });
  assert.equal(r.status, 200);
  const d = (await r.json()) as { siteId: string; email: string; goUrl: string };
  assert.equal(d.siteId, "manduu-com");
  assert.equal(d.email, "kofiahen001+testheatmaptracker@gmail.com");
  assert.match(d.goUrl, /\/go\/[A-Za-z0-9_-]{20,}$/);
  const bad = await fetch(base + "/signin/save", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", origin: base }, body: new URLSearchParams({ from: "manduu-com", website: "manduu.com", email: "nope" }).toString() });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /email/i);
});

test("a form post that says Origin: null is accepted only when the browser says it is same-origin", async () => {
  const post = (extra: Record<string, string>) => save({ from: "example-site", website: "example.site", email: "owner@example.test" }, extra);
  assert.equal((await post({ origin: "null" })).status, 403);
  assert.equal((await post({ origin: "null", "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post({ origin: "null", "sec-fetch-site": "same-origin" })).status, 303);
});

test("every save error answers in JSON when the page asks for JSON", async () => {
  const j = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(base + "/signin/save", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", origin: base, ...headers }, body: new URLSearchParams(fields).toString() });
  for (const r of [await j({ from: "nope", website: "a.com", email: "a@b.co" }), await j({ from: "example-site", website: "a.com", email: "a@b.co" }, { origin: "http://evil.example" }), await j({ from: "example-site", website: "a.com", email: "a@b.co" }, { "content-type": "text/plain" })]) {
    assert.match(r.headers.get("content-type") ?? "", /json/);
    assert.equal(typeof ((await r.json()) as { error: string }).error, "string");
  }
});

test("names in other languages keep different folders, and page views never lock the page out", async () => {
  const a = await save({ from: "example-site", website: "Café.com", email: "a@b.co" }, { origin: base });
  const b = await save({ from: "example-site", website: "caf.com", email: "a@b.co" }, { origin: base });
  assert.notEqual(a.headers.get("location"), b.headers.get("location"));
  const html = await (await get("/signin?site=example-site")).text();
  const first = codeFromSignInHtml(html);
  let last = "";
  for (let i = 0; i < 520; i++) {
    const r = await get("/signin?site=example-site");
    assert.equal(r.status, 200);
    last = codeFromSignInHtml(await r.text());
  }
  assert.equal((await get(`/go/${first}`)).status, 410); // the oldest link was dropped at the cap
  assert.equal((await get(`/go/${last}`)).status, 302); // the newest still works
});

test("the website is shown without its scheme, www and path", async () => {
  const r = await save({ from: "example-site", website: "https://www.Acme-Shop.com/store", email: "a@b.co" }, { origin: base });
  const html = await (await get(r.headers.get("location")!)).text();
  assert.match(html, /<span data-view data-site>acme-shop\.com<\/span>/);
});
