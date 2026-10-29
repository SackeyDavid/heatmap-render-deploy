import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join, posix, resolve, sep } from "node:path";
import { HEATMAP_FAKE_JS } from "./heatmap-fake.ts";

export interface ScriptsHostConfig {
  host: string;
  port: number;
  /** Published object root (local-fs storage adapter directory). */
  storageRoot: string;
  /** Origins allowed for cross-origin script loads (Shopify preview, local UI). */
  corsOrigins: string[];
}

export interface RunningScriptsHost {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function safeKey(storageRoot: string, urlPath: string): string | null {
  const key = urlPath.replace(/^\/+/, "").split("?")[0]!;
  if (!key || key.includes("..")) return null;
  const abs = resolve(storageRoot, key);
  if (abs !== storageRoot && !abs.startsWith(storageRoot + sep)) return null;
  return key;
}

export function createScriptsHostHandler(config: ScriptsHostConfig) {
  const root = resolve(config.storageRoot);
  const cors = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
    return {};
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...cors(req), "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Max-Age": "600" });
        res.end();
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "application/json", ...cors(req) });
        res.end(JSON.stringify({ error: { code: "method-not-allowed", message: "Only GET is supported here." } }));
        return;
      }
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/__hm/heatmap-fake.js") {
        res.writeHead(200, { "Content-Type": MIME[".js"]!, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors(req) });
        res.end(req.method === "HEAD" ? undefined : HEATMAP_FAKE_JS);
        return;
      }
      // <folder>/current.js is the script the pointer <folder>/current.json names (what a store page's tag loads; short cache, as a CDN would).
      if (path.endsWith("/current.js")) {
        const dir = dirname(path);
        const pointerKey = safeKey(root, posix.join(dir, "current.json"));
        let version: string | undefined;
        try {
          if (pointerKey) version = (JSON.parse(await readFile(join(root, pointerKey), "utf8")) as { version?: string }).version;
        } catch {
          version = undefined;
        }
        const scriptKey = version && /^[A-Za-z0-9._-]+$/.test(version) ? safeKey(root, posix.join(dir, version, "script.js")) : null;
        const body = scriptKey ? await readFile(join(root, scriptKey), "utf8").catch(() => null) : null;
        if (body === null) {
          res.writeHead(404, { "Content-Type": "application/json", ...cors(req) });
          res.end(JSON.stringify({ error: { code: "not-found", message: "Not found." } }));
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[".js"]!, "Content-Length": Buffer.byteLength(body), "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff", ...cors(req) });
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }
      const key = safeKey(root, path);
      if (!key) {
        res.writeHead(404, { "Content-Type": "application/json", ...cors(req) });
        res.end(JSON.stringify({ error: { code: "not-found", message: "Not found." } }));
        return;
      }
      const file = join(root, key);
      let st;
      try {
        st = statSync(file);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json", ...cors(req) });
        res.end(JSON.stringify({ error: { code: "not-found", message: "Not found." } }));
        return;
      }
      if (!st.isFile()) {
        res.writeHead(404, { "Content-Type": "application/json", ...cors(req) });
        res.end(JSON.stringify({ error: { code: "not-found", message: "Not found." } }));
        return;
      }
      const ext = key.includes(".") ? key.slice(key.lastIndexOf(".")) : "";
      const type = MIME[ext] ?? "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": st.size,
        "Cache-Control": key.endsWith(".js") ? "public, max-age=60" : "no-store",
        "X-Content-Type-Options": "nosniff",
        ...cors(req),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(500, { "Content-Type": "application/json", ...cors(req) });
      res.end(JSON.stringify({ error: { code: "internal", message: "Something went wrong." } }));
    }
  };
}

export async function startScriptsHost(config: ScriptsHostConfig): Promise<RunningScriptsHost> {
  const handler = createScriptsHostHandler(config);
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : config.port;
  return {
    server,
    port,
    url: `http://${config.host}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Reads a published script body by storage key (for smoke tests). */
export async function readPublished(storageRoot: string, key: string): Promise<string | null> {
  const safe = safeKey(resolve(storageRoot), `/${key}`);
  if (!safe) return null;
  try {
    return await readFile(join(resolve(storageRoot), safe), "utf8");
  } catch {
    return null;
  }
}
