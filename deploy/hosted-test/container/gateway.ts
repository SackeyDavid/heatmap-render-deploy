#!/usr/bin/env node
/**
 * Hosted test gateway: ONE public port in front of the whole local stack.
 *   /            the merchant screens (built static files)
 *   /api/*       the HTTP API            (prefix removed, forwarded to 127.0.0.1:28787)
 *   /scripts/*   published tracking files (prefix removed, forwarded to 127.0.0.1:28788)
 *   /auth/signin?site=ID   a public stand-in for Heatmap's sign-in: signs a short-lived token for a site listed in sites.json
 *   /healthz     200 once the stack is up
 * It starts tools/local/dev-stack.ts as a child and hands it ONLY the settings listed in `childEnv` (never the whole environment).
 * Testing aid, not production: the sign-in has no password unless TEST_PASSWORD is set (then the screens and the sign-in ask for it; /api, /scripts and /healthz stay open on purpose, see below).
 */
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signToken } from "../../../tools/local/site-registry/token.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const PORT = Number(process.env.PORT || 8080);
const API_PORT = 28787;
const SCRIPTS_PORT = 28788;
const AUTH_PORT = 28786;
const UI_DIST = resolve(process.env.UI_DIST || join(ROOT, "ui-dist"));
const DATA_DIR = resolve(process.env.HEATMAP_DATA_DIR || "/data");
// PUBLIC_ORIGIN can be set by hand; Render provides RENDER_EXTERNAL_URL by itself.
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const TOKEN_SECRET = process.env.HEATMAP_TOKEN_SECRET && process.env.HEATMAP_TOKEN_SECRET.length >= 32 ? process.env.HEATMAP_TOKEN_SECRET : randomBytes(32).toString("hex");
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "";
const TOKEN_TTL_SECONDS = 8 * 3600;
/** A job that reads a description through a slow free model can take a while; nothing legitimate takes longer than this. */
const UPSTREAM_TIMEOUT_MS = 150_000;

interface Site { siteId: string; userId: string; userEmail: string }
const SITES: Site[] = (JSON.parse(readFileSync(join(HERE, "sites.json"), "utf8")) as { sites: Site[] }).sites;
mkdirSync(DATA_DIR, { recursive: true });
copyFileSync(join(HERE, "sites.json"), join(DATA_DIR, "sites.json"));

/** The only settings the stack receives. The OpenRouter and Groq keys are passed through by name; nothing else from this process's environment is. */
const childEnv: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "/root",
  NODE_ENV: "production",
  HEATMAP_MODE: "local",
  // With bucket settings present the files must go to the bucket, so a service created by hand without HEATMAP_MANIFEST still stores them there (not on its own disk).
  HEATMAP_MANIFEST: process.env.HEATMAP_MANIFEST || (process.env.AWS_S3_BUCKET ? "manifests/http-render.yaml" : "manifests/http-local-openrouter.yaml"),
  HEATMAP_TOKEN_SECRET: TOKEN_SECRET,
  HEATMAP_DATA_DIR: DATA_DIR,
  HEATMAP_HTTP_PORT: String(API_PORT),
  HEATMAP_SCRIPTS_PORT: String(SCRIPTS_PORT),
  LOCAL_AUTH_PORT: String(AUTH_PORT),
  LOCAL_SITES_FILE: join(DATA_DIR, "sites.json"),
  UI_ORIGIN: PUBLIC_ORIGIN,
  // Where the address of a published tracking file points: the bucket's public address when the files live in a bucket, otherwise this app's own /scripts.
  HEATMAP_SCRIPT_URL_BASE: (process.env.AWS_S3_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "") || `${PUBLIC_ORIGIN}/scripts`,
  HEATMAP_RATE_LIMIT_PER_MIN: process.env.HEATMAP_RATE_LIMIT_PER_MIN || "10",
  HEATMAP_MAX_OPEN_JOBS: process.env.HEATMAP_MAX_OPEN_JOBS || "5",
};
if (process.env.OPENROUTER_API_KEY) childEnv.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// Groq reads first when its key is set (manifests/http-render.yaml, providerModels). Without it the app reads through OpenRouter alone.
if (process.env.GROQ_API_KEY) childEnv.GROQ_API_KEY = process.env.GROQ_API_KEY;
// Hosted setups that keep the tracking files in a bucket (manifests/http-render.yaml) also pass the bucket settings, by name, when they are set.
for (const name of ["AWS_REGION", "AWS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_ENDPOINT", "AWS_S3_PUBLIC_BASE_URL"]) {
  const value = process.env[name];
  if (value) childEnv[name] = value;
}

// One bad request must never take the whole test down: log it (no request data) and keep serving.
process.on("unhandledRejection", (reason) => console.error("[gateway] unhandled rejection:", reason instanceof Error ? reason.message : "unknown"));

let ready = false;
const stack = spawn(process.execPath, ["--import", "tsx", "tools/local/dev-stack.ts"], { cwd: ROOT, env: childEnv, stdio: ["ignore", "inherit", "inherit"] });
stack.on("exit", (code) => {
  console.error(`[gateway] the stack stopped (exit ${code}); stopping so the host restarts it`);
  process.exit(1);
});

async function waitForStack(): Promise<void> {
  for (let i = 0; i < 360; i++) { // up to 3 minutes: a free host can be slow to start
    const ok = await new Promise<boolean>((done) => {
      const r = httpRequest({ host: "127.0.0.1", port: API_PORT, path: "/healthz", timeout: 1500 }, (res) => { res.resume(); done((res.statusCode ?? 500) < 500); });
      r.on("error", () => done(false));
      r.on("timeout", () => { r.destroy(); done(false); });
      r.end();
    });
    if (ok) { ready = true; console.log("[gateway] the stack is up"); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("[gateway] the stack did not come up in 3 minutes");
  process.exit(1);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain; charset=utf-8",
};

function send(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, "x-content-type-options": "nosniff", ...extra });
  res.end(body);
}

function passwordOk(req: IncomingMessage): boolean {
  if (!TEST_PASSWORD) return true;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const given = Buffer.from(header.slice(6), "base64").toString("utf8");
  const pass = given.includes(":") ? given.slice(given.indexOf(":") + 1) : given;
  const a = Buffer.from(pass);
  const b = Buffer.from(TEST_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

function proxy(req: IncomingMessage, res: ServerResponse, port: number, path: string): void {
  const headers = { ...req.headers, host: `127.0.0.1:${port}`, "x-forwarded-host": req.headers.host ?? "", "x-forwarded-proto": PUBLIC_ORIGIN.startsWith("https") ? "https" : "http" };
  const upstream = httpRequest({ host: "127.0.0.1", port, path, method: req.method, headers, timeout: UPSTREAM_TIMEOUT_MS }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => { if (!res.headersSent) send(res, 502, "The service behind this page is not answering. Try again in a moment."); else res.end(); });
  // A browser that goes away must not leave the upstream request hanging.
  res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
  req.pipe(upstream);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, "Bad path"); // a malformed % escape must never crash the gateway
  }
  let rel = normalize(decoded).replace(/^([/\\])+/, "");
  if (rel.includes("..")) return send(res, 400, "Bad path");
  if (rel.split(/[/\\]/).some((part) => part.startsWith("."))) return send(res, 404, "Not found"); // dotfiles (.env and the like) are never app screens
  let file = join(UI_DIST, rel || "index.html");
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    // Not a file: a screen route of the single-page app.
    if (extname(rel)) return send(res, 404, "Not found");
    file = join(UI_DIST, "index.html");
  }
  try {
    const body = await readFile(file);
    const cache = file.includes(`${join(UI_DIST, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": cache, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    send(res, 404, "Not found");
  }
}

createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;
      if (path === "/healthz") return send(res, ready ? 200 : 503, ready ? "ok" : "starting");
      if (!ready) return send(res, 503, "Starting up. Please reload in a few seconds.", "text/plain; charset=utf-8", { "retry-after": "5" });
      // Public by design: the published tracking files (a merchant's own website loads them) and the API. The API needs a signed token, which
      // only the sign-in page hands out, and the app sends it in an Authorization header that replaces the browser's cached password, so a
      // password check here would break every call. Everything else (screens, sign-in) asks for TEST_PASSWORD when it is set.
      const isScript = path === "/scripts" || path.startsWith("/scripts/");
      const isApi = path === "/api" || path.startsWith("/api/");
      if (!isScript && !isApi && !passwordOk(req)) return send(res, 401, "Password needed.", "text/plain; charset=utf-8", { "www-authenticate": 'Basic realm="Heatmap test"' });

      if (path === "/auth/signin") {
        const site = SITES.find((s) => s.siteId === (url.searchParams.get("site") ?? ""));
        if (!site) return send(res, 404, "That test site is not registered.");
        const iat = Math.floor(Date.now() / 1000);
        const token = signToken({ iss: "heatmap-local", sub: site.userId, siteId: site.siteId, email: site.userEmail, iat, exp: iat + TOKEN_TTL_SECONDS }, TOKEN_SECRET);
        return send(res, 302, "", "text/plain; charset=utf-8", { location: `/?token=${encodeURIComponent(token)}`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
      }
      if (path === "/api" || path.startsWith("/api/")) return proxy(req, res, API_PORT, `${path.slice(4) || "/"}${url.search}`);
      if (isScript) return proxy(req, res, SCRIPTS_PORT, `${path.slice(8) || "/"}${url.search}`);
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
      return await serveStatic(req, res, path);
    } catch {
      if (!res.headersSent) send(res, 500, "Something went wrong.");
    }
  })();
}).listen(PORT, "0.0.0.0", () => {
  console.log(`[gateway] listening on 0.0.0.0:${PORT} (public address ${PUBLIC_ORIGIN}${TEST_PASSWORD ? ", password on" : ", NO password"})`);
  void waitForStack();
});
