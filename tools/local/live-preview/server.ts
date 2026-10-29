/**
 * The one loopback server of `npm run live:preview`: a capture receiver (POST /capture) and the published-script server
 * (GET /script.js). Bound to 127.0.0.1 only. It never evaluates or logs captured HTML, and it writes one file only: inside
 * <dataDir>/pages/, named by pageFileName(url) (never from a client-supplied path).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve, sep } from "node:path";
import { MAX_SAVED_PAGE_BYTES } from "../../../src/domain/page-limits.ts";
import { pageFileName } from "../../../src/domain/page-file-name.ts";

export const LOOPBACK_HOST = "127.0.0.1";
/** Hard cap on the raw request body (JSON escaping makes the body a little larger than the HTML it carries). */
const MAX_BODY_BYTES = MAX_SAVED_PAGE_BYTES * 2 + 10_000;
/** Most distinct captures stored in one run; beyond it the receiver answers 429. */
export const MAX_CAPTURES_PER_RUN = 20;

export function assertLoopbackHost(host: string): void {
  if (host !== LOOPBACK_HOST) throw new Error(`live:preview binds ${LOOPBACK_HOST} only; refusing host "${host}"`);
}

/** The origin (scheme + host + port) of a page address; throws for anything that is not an http(s) address. */
export function originOf(pageUrl: string): string {
  const u = new URL(pageUrl);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`--page-url must be an http(s) address, got "${pageUrl}"`);
  return u.origin;
}

export interface Capture {
  url: string;
  file: string;
  bytes: number;
}

export interface PreviewServer {
  /** http://127.0.0.1:<port> */
  url: string;
  port: number;
  pagesDir: string;
  /** Scripts are served from here once set (GET /script.js is 404 before). */
  setScript(text: string): void;
  /** Resolves on the next accepted capture; rejects with a clear message after timeoutMs. */
  waitForCapture(timeoutMs: number): Promise<Capture>;
  close(): Promise<void>;
}

export async function startPreviewServer(opts: { host?: string; port: number; pageUrl: string; dataDir: string }): Promise<PreviewServer> {
  const host = opts.host ?? LOOPBACK_HOST;
  assertLoopbackHost(host);
  const pageOrigin = originOf(opts.pageUrl);
  const pagesDir = resolve(opts.dataDir, "pages");
  await mkdir(pagesDir, { recursive: true });
  let script: string | null = null;
  let boundPort = 0;
  const storedFiles = new Set<string>();
  const waiters = new Set<(c: Capture) => void>();

  const cors = (req: IncomingMessage): Record<string, string> =>
    req.headers.origin === pageOrigin
      ? {
          "Access-Control-Allow-Origin": pageOrigin,
          "Access-Control-Allow-Private-Network": "true",
          Vary: "Origin",
        }
      : {};
  const send = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(req), ...extra });
    res.end(JSON.stringify(body));
  };
  const fail = (req: IncomingMessage, res: ServerResponse, status: number, error: string, extra: Record<string, string> = {}) =>
    send(req, res, status, { ok: false, error }, extra);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // DNS-rebinding guard: only requests addressed to this exact loopback address are served.
    if (req.headers.host !== `${LOOPBACK_HOST}:${boundPort}`) return fail(req, res, 403, "wrong host header");
    const path = (req.url ?? "").split("?")[0];
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== pageOrigin) return fail(req, res, 403, "origin not allowed");

    if (req.method === "OPTIONS" && (path === "/capture" || path === "/script.js")) {
      res.writeHead(204, {
        ...cors(req),
        "Access-Control-Allow-Methods": path === "/capture" ? "POST, OPTIONS" : "GET, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "no-store",
      });
      return void res.end();
    }

    if (req.method === "GET" && path === "/script.js") {
      if (script === null) return fail(req, res, 404, "no script published yet");
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": pageOrigin,
        "Access-Control-Allow-Private-Network": "true",
        Vary: "Origin",
      });
      return void res.end(script);
    }

    if (req.method === "POST" && path === "/capture") {
      if (origin === undefined) return fail(req, res, 403, "origin header required");
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return fail(req, res, 415, "send JSON (content-type application/json)");
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > MAX_BODY_BYTES) return tooLarge(req, res);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES) return tooLarge(req, res);
        chunks.push(chunk as Buffer);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return fail(req, res, 400, "body is not valid JSON");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail(req, res, 400, "body must be a JSON object {url, html}");
      const { url, html } = parsed as { url?: unknown; html?: unknown };
      if (typeof url !== "string" || typeof html !== "string" || html.length === 0) return fail(req, res, 400, "body needs a string url and a non-empty string html");
      let u: URL;
      try {
        u = new URL(url); // a path-like value ("../x", "/etc/passwd") has no origin and throws
      } catch {
        return fail(req, res, 400, "url must be a full http(s) address");
      }
      if (u.origin !== pageOrigin) return fail(req, res, 400, `url origin must be ${pageOrigin}`);
      const bytes = Buffer.byteLength(html, "utf8");
      if (bytes > MAX_SAVED_PAGE_BYTES) return tooLarge(req, res);
      const file = pageFileName(u.href);
      const target = resolve(pagesDir, file);
      if (!target.startsWith(pagesDir + sep)) return fail(req, res, 400, "unsafe file name"); // belt and braces: pageFileName cannot produce this
      if (!storedFiles.has(file) && storedFiles.size >= MAX_CAPTURES_PER_RUN) return fail(req, res, 429, `too many captures in this run (limit ${MAX_CAPTURES_PER_RUN})`);
      storedFiles.add(file);
      await writeFile(target, html, "utf8");
      const capture: Capture = { url: u.href, file, bytes };
      for (const w of [...waiters]) w(capture);
      return send(req, res, 200, { ok: true, file, bytes });
    }

    return fail(req, res, 404, "not found");
  };

  function tooLarge(req: IncomingMessage, res: ServerResponse): void {
    fail(req, res, 413, `page is larger than ${MAX_SAVED_PAGE_BYTES} bytes`, { Connection: "close" });
    res.once("finish", () => req.destroy());
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) fail(req, res, 500, "internal error"); // never echo details or the page
      else res.end();
    });
  });
  await new Promise<void>((ok, bad) => {
    server.once("error", bad);
    server.listen(opts.port, host, () => ok());
  });
  boundPort = (server.address() as AddressInfo).port;

  return {
    url: `http://${LOOPBACK_HOST}:${boundPort}`,
    port: boundPort,
    pagesDir,
    setScript: (t) => {
      script = t;
    },
    waitForCapture: (timeoutMs) =>
      new Promise<Capture>((ok, bad) => {
        const done = (c: Capture) => {
          clearTimeout(timer);
          waiters.delete(done);
          ok(c);
        };
        const timer = setTimeout(() => {
          waiters.delete(done);
          bad(new Error(`No capture arrived within ${Math.round(timeoutMs / 1000)} seconds. Run the capture snippet in the browser tab on the real page, or pass --from-html <file>.`));
        }, timeoutMs);
        waiters.add(done);
      }),
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
