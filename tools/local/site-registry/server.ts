// Local Heatmap login + site context stand-in (Track 2, dev-only, removable). NOT Heatmap's real login.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { MIN_SECRET_LENGTH, SITE_ID_RE, signToken } from "./token.ts";
import { SiteRegistry, siteIdFromWebsite, validateSite } from "./registry.ts";
import { authMessagePage, signInLinkPage } from "./auth-pages/pages.ts";

export const DEFAULT_PORT = 8786;
export const HOST = "127.0.0.1";
/** How long a one-time sign-in link stays valid. */
export const CODE_TTL_MS = 48 * 60 * 60 * 1000;
/** Links waiting at once. Each page view makes one, and they now live for two days. */
const MAX_PENDING = 500;
const MAX_BODY = 8 * 1024;

export interface Config {
  secret: string;
  registryFile: string;
  uiBase: string;
  port: number;
  tokenTtlSeconds: number;
  log: (line: string) => void;
  now: () => number; // ms
}

/** Fail closed: throws with a plain message when the environment must not run this tool. */
export function configFromEnv(env: NodeJS.ProcessEnv, overrides: Partial<Config> = {}): Config {
  if (env.HEATMAP_MODE === "production") throw new Error("Refusing to start: HEATMAP_MODE=production. This is a dev-only stand-in for Heatmap's login.");
  const secret = env.HEATMAP_TOKEN_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`Refusing to start: set HEATMAP_TOKEN_SECRET to at least ${MIN_SECRET_LENGTH} characters.`);
  const ttl = env.LOCAL_TOKEN_TTL_SECONDS ? Number(env.LOCAL_TOKEN_TTL_SECONDS) : 8 * 3600;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 24 * 3600) throw new Error("LOCAL_TOKEN_TTL_SECONDS must be an integer between 60 and 86400.");
  const port = env.LOCAL_AUTH_PORT ? Number(env.LOCAL_AUTH_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("LOCAL_AUTH_PORT must be a valid port.");
  return {
    secret,
    registryFile: env.LOCAL_SITES_FILE ?? ".local-data/sites.json",
    uiBase: env.UI_BASE ?? "http://127.0.0.1:5173",
    port,
    tokenTtlSeconds: ttl,
    log: (l) => console.log(l),
    now: () => Date.now(),
    ...overrides,
  };
}

const sha = (s: string): Buffer => createHash("sha256").update(s).digest();

interface Pending { hash: Buffer; siteId: string; expires: number }

export function createAuthServer(cfg: Config): Server {
  const registry = new SiteRegistry(cfg.registryFile);
  let pending: Pending[] = [];
  let boundPort = cfg.port;

  const sweep = () => { const t = cfg.now(); pending = pending.filter((p) => p.expires > t); };
  /** Constant-time lookup across all pending codes; consumes on match. */
  const consume = (code: string): Pending | undefined => {
    sweep();
    const h = sha(code);
    let found: Pending | undefined;
    for (const p of pending) if (timingSafeEqual(p.hash, h)) found = p;
    if (found) pending = pending.filter((p) => p !== found);
    return found;
  };

  /** A new one-time link for the site. At the cap the oldest waiting link is dropped. */
  const issueLink = (siteId: string): string => {
    sweep();
    if (pending.length >= MAX_PENDING) pending.shift(); // the oldest waiting link goes, so repeated page views can never lock the page out
    const code = randomBytes(32).toString("base64url");
    pending.push({ hash: sha(code), siteId, expires: cfg.now() + CODE_TTL_MS });
    const goUrl = `http://${HOST}:${boundPort}/go/${code}`;
    cfg.log(`Sign-in link for site "${siteId}" (single use, valid ${CODE_TTL_MS / 3_600_000} hours): ${goUrl}`);
    return goUrl;
  };

  const send = (res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...extra });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, v: unknown) => send(res, status, JSON.stringify(v), "application/json; charset=utf-8");
  const page = (res: ServerResponse, status: number, title: string, msg: string, error = true) =>
    send(res, status, authMessagePage(title, msg, error), "text/html; charset=utf-8");

  const readBody = (req: IncomingMessage): Promise<string | undefined> =>
    new Promise((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve(undefined); req.resume(); req.removeAllListeners("data"); req.on("data", () => undefined); } else chunks.push(c); });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => resolve(undefined));
    });

  const server = createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: only loopback Host headers are served.
      const host = (req.headers.host ?? "").toLowerCase();
      const okHosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
      if (!okHosts.includes(host)) return send(res, 403, "Forbidden host");
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname;

      if (req.method === "GET" && path === "/signin") {
        const siteId = url.searchParams.get("site") ?? "";
        if (!SITE_ID_RE.test(siteId) || !registry.get(siteId)) return page(res, 404, "Site not found", "That site is not registered. Add it with POST /api/sites or edit the sites file.");
        const goUrl = issueLink(siteId);
        const site = registry.get(siteId)!;
        return send(res, 200, signInLinkPage(siteId, goUrl, site.userEmail, url.searchParams.get("saved") === "1", site.label), "text/html; charset=utf-8");
      }

      if (req.method === "POST" && path === "/signin/save") {
        const wantsJson = (req.headers.accept ?? "").includes("application/json");
        const refuse = (status: number, title: string, msg: string) => (wantsJson ? json(res, status, { error: msg }) : page(res, status, title, msg));
        // A form on this page's own origin only (the pencil edit); no other website may submit it.
        const origin = (req.headers.origin ?? "").toLowerCase();
        // A form post from this page can say "Origin: null" (the page sends no referrer), so it must also say it is same-origin.
        const sameOrigin = origin === "" || origin === `http://${host}` || (origin === "null" && req.headers["sec-fetch-site"] === "same-origin");
        if (!sameOrigin) return refuse(403, "Not allowed", "That request did not come from this page.");
        if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return refuse(415, "Not allowed", "Please save from the sign-in page.");
        const raw = await readBody(req);
        if (raw === undefined) return refuse(413, "Too large", "That request was too large.");
        const form = new URLSearchParams(raw);
        const from = registry.get(form.get("from") ?? "");
        if (!from) return refuse(404, "Site not found", "That site is not registered.");
        const siteId = siteIdFromWebsite(form.get("website") ?? "");
        const v = validateSite({ siteId, userId: from.userId, userEmail: (form.get("email") ?? "").trim(), label: (form.get("website") ?? "").trim().slice(0, 100) || siteId });
        if (!v.ok) return refuse(400, "Could not save", siteId ? "Please check the email address and try again." : "Please type your website, for example example.com.");
        // The typed website must not land on a different, existing site (that would hand it another person's name and email).
        if (v.site.siteId !== from.siteId && registry.get(v.site.siteId)) return refuse(409, "Could not save", "That website is already set up here. Please use a different one.");
        registry.save(v.site);
        // The page saves in place (no new page): it gets the new link and shows the new values.
        if ((req.headers.accept ?? "").includes("application/json")) {
          const goUrl = issueLink(v.site.siteId);
          return json(res, 200, { siteId: v.site.siteId, label: v.site.label, email: v.site.userEmail, goUrl });
        }
        return send(res, 303, "", "text/plain; charset=utf-8", { location: `/signin?site=${encodeURIComponent(v.site.siteId)}&saved=1` });
      }

      if (req.method === "GET" && path.startsWith("/go/")) {
        const code = path.slice(4);
        if (!/^[A-Za-z0-9_-]{20,100}$/.test(code)) return page(res, 400, "Invalid link", "That link is not valid.");
        const entry = consume(code);
        if (!entry) return page(res, 410, "Link expired", "That link was already used or has expired. Request a new one at /signin?site=...");
        const site = registry.get(entry.siteId);
        if (!site) return page(res, 404, "Site not found", "That site is no longer registered.");
        const iat = Math.floor(cfg.now() / 1000);
        const token = signToken({ iss: "heatmap-local", sub: site.userId, siteId: site.siteId, email: site.userEmail, label: site.label, iat, exp: iat + cfg.tokenTtlSeconds }, cfg.secret);
        const dest = new URL(cfg.uiBase);
        dest.searchParams.set("token", token);
        return send(res, 302, "", "text/plain; charset=utf-8", { location: dest.toString() });
      }

      if (path === "/api/sites" && req.method === "GET") return json(res, 200, { sites: registry.list() });

      if (path === "/api/sites" && req.method === "POST") {
        // Requiring application/json forces a CORS preflight from browsers, which this server never answers.
        if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return json(res, 415, { error: "Send application/json." });
        if (req.headers.origin) return json(res, 403, { error: "Browser cross-origin requests are not accepted." });
        const raw = await readBody(req);
        if (raw === undefined) return json(res, 413, { error: "Request body too large." });
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { return json(res, 400, { error: "Body must be valid JSON." }); }
        const v = validateSite(parsed);
        if (!v.ok) return json(res, 400, { error: v.error });
        return registry.add(v.site) === "exists" ? json(res, 409, { error: "That siteId is already registered." }) : json(res, 201, { site: v.site });
      }

      return send(res, 404, "Not found");
    } catch {
      if (!res.headersSent) send(res, 500, "Internal error");
    }
  });
  server.on("listening", () => { const a = server.address(); if (a && typeof a === "object") boundPort = a.port; });
  return server;
}

export function listenLoopback(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => { const a = server.address(); resolve(typeof a === "object" && a ? a.port : port); });
  });
}
