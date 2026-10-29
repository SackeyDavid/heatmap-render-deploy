// Thin HTTP entrypoint (Track 1, D9). Same OperationService as the CLI; no business logic lives here.
import { requestsDir } from "../../domain/data-layout.ts";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { App } from "../../composition/wire.ts";
import { InvalidInputError } from "../../domain/errors.ts";
import { isPlainEmailAddress } from "../../domain/email-address.ts";
import { REQUEST_ID_RE } from "../../domain/request-id.ts";
import type { Job } from "../../domain/types.ts";
import type { Logger } from "../../ports/index.ts";
import type { HttpConfig } from "./config.ts";
import { bearerFrom, verifyToken, type TokenClaims } from "./jwt.ts";
import { failureCode, MSG, statusMessage, type PublicStatus } from "./messages.ts";
import { stepKind } from "../../domain/step-id.ts";
import { recoverInterruptedJobs } from "./recovery.ts";
import { removeSavedPages, writeArtifacts, writeSavedPages } from "./pages.ts";
import { SiteRateLimiter } from "./rate-limit.ts";
import { POST_400_CODES, type Post400Code } from "./codes.ts";
import { resolveHttpOperations } from "./operations.ts";
import { parseRequestBody } from "./validate.ts";


export interface HttpServerOptions {
  app: App;
  config: HttpConfig;
  dataDir: string;
  logger: Logger;
  /** Milliseconds since the epoch; injectable for tests. */
  now?: () => number;
  newRequestId?: () => string;
}

export interface RunningHttpServer {
  server: Server;
  port: number;
  url: string;
  /** Resolves when every background job started so far has finished (tests, graceful shutdown). */
  whenIdle(): Promise<void>;
  close(): Promise<void>;
}

interface RequestMeta {
  requestId: string;
  siteId: string;
  createdAt: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
  }
}

/** The mapped input of an accepted request, kept in its folder for the approval. */
const STORED_INPUT = "input.json";

const defaultRequestId = () => `req-${randomBytes(10).toString("hex")}`;

export function createRequestHandler(opts: HttpServerOptions) {
  const { app, config, dataDir, logger } = opts;
  const now = opts.now ?? Date.now;
  const newRequestId = opts.newRequestId ?? defaultRequestId;
  // Fails at startup (ConfigError naming the env var) if the operator's choices name an operation this manifest does not serve over HTTP.
  const operations = resolveHttpOperations({ defaultOperation: config.operation, allowedOperations: config.allowedOperations }, [...app.httpOperations.keys()]);
  const limiter = new SiteRateLimiter(config.rateLimitPerMinute);
  const openBySite = new Map<string, number>();
  const metas = new Map<string, RequestMeta>();
  const crashed = new Set<string>();
  const background = new Set<Promise<unknown>>();

  const setOpen = (site: string, delta: number) => {
    const n = (openBySite.get(site) ?? 0) + delta;
    if (n <= 0) openBySite.delete(site);
    else openBySite.set(site, n);
  };

  const corsHeaders = (req: IncomingMessage): Record<string, string> => {
    const h: Record<string, string> = { Vary: "Origin" };
    if (req.headers.origin === config.uiOrigin) {
      h["Access-Control-Allow-Origin"] = config.uiOrigin;
      h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
      h["Access-Control-Max-Age"] = "600";
    }
    return h;
  };

  const send = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(req),
      ...extra,
    });
    res.end(text);
  };

  const authenticate = (req: IncomingMessage): TokenClaims => {
    const token = bearerFrom(req.headers.authorization);
    if (!token) throw new HttpError(401, "unauthenticated", MSG.unauthorized, { "WWW-Authenticate": "Bearer" });
    const r = verifyToken(token, { secret: config.tokenSecret, acceptedIssuers: config.acceptedIssuers, nowSeconds: Math.floor(now() / 1000) });
    if (r.ok) return r.claims;
    if (r.reason === "issuer_not_accepted") throw new HttpError(403, "wrong-environment", MSG.wrongEnvironment);
    throw new HttpError(401, "unauthenticated", MSG.unauthorized, { "WWW-Authenticate": "Bearer" });
  };

  const readBody = (req: IncomingMessage, res: ServerResponse): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const tooLarge = () => {
        // Answer now, then discard (never store) what is still arriving, up to a budget, so the client sees the 413
        // instead of a reset; after that the connection is dropped.
        res.setHeader("Connection", "close");
        res.once("finish", () => {
          let drained = 0;
          const timer = setTimeout(() => req.destroy(), 5000);
          req.on("data", (c: Buffer) => {
            drained += c.length;
            if (drained > 4 * config.bodyLimitBytes) req.destroy();
          });
          req.on("close", () => clearTimeout(timer));
          req.resume();
        });
        reject(new HttpError(413, "payload-too-large", MSG.tooLarge));
      };
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > config.bodyLimitBytes) return tooLarge();
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      req.on("data", (c: Buffer) => {
        if (done) return;
        size += c.length;
        if (size > config.bodyLimitBytes) {
          done = true;
          chunks.length = 0;
          tooLarge();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!done) resolve(Buffer.concat(chunks));
      });
      req.on("error", (e) => {
        if (!done) reject(e);
      });
    });

  const saveMeta = async (meta: RequestMeta) => {
    metas.set(meta.requestId, meta);
    await mkdir(requestsDir(dataDir), { recursive: true });
    await writeFile(join(requestsDir(dataDir), `${meta.requestId}.json`), JSON.stringify(meta), "utf8");
  };

  const loadMeta = async (id: string): Promise<RequestMeta | null> => {
    const cached = metas.get(id);
    if (cached) return cached;
    try {
      const m = JSON.parse(await readFile(join(requestsDir(dataDir), `${id}.json`), "utf8")) as RequestMeta;
      if (m.requestId === id && typeof m.siteId === "string") {
        metas.set(id, m);
        return m;
      }
    } catch {
      // unknown id
    }
    return null;
  };

  const createRequest = async (req: IncomingMessage, res: ServerResponse, claims: TokenClaims) => {
    const wait = limiter.take(claims.siteId, now());
    if (wait > 0) throw new HttpError(429, "rate-limited", MSG.rateLimited, { "Retry-After": String(wait) });
    if ((openBySite.get(claims.siteId) ?? 0) >= config.maxOpenJobsPerSite) {
      throw new HttpError(429, "cap-open-requests", MSG.tooManyOpen, { "Retry-After": "30" });
    }
    setOpen(claims.siteId, 1); // reserve the slot now so concurrent posts cannot overshoot the cap
    let accepted = false;
    let requestId: string | undefined;
    try {
      if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "unsupported-media-type", MSG.notJson);
      const raw = await readBody(req, res);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new HttpError(400, "invalid-request", MSG.badJson);
      }
      const parsed = parseRequestBody(parsedJson, operations);
      if (!parsed.ok) throw new HttpError(400, parsed.code, parsed.message);
      const notifyEmail = parsed.value.notifyEmail ?? claims.email;
      if (!notifyEmail) throw new HttpError(400, "email-required", MSG.needEmail);
      // The same rule the mail sender applies, so a token email that could not be mailed is refused here, not after the job.
      if (!isPlainEmailAddress(notifyEmail)) throw new HttpError(400, "invalid-email", MSG.email);

      // The operation owns its own fields and checks; siteId comes from the verified token only (a body siteId is never read).
      const mapper = app.httpOperations.get(parsed.value.operation)!; // resolveHttpOperations guarantees every allowed operation has one
      const mapped = mapper.map({ siteId: claims.siteId, prompt: parsed.value.prompt, pageUrls: parsed.value.pageUrls, notifyEmail }, parsed.value.body);
      if (!mapped.ok) {
        // A code outside the documented API codes is a mapper bug: answer with the generic one rather than invent a contract.
        const code: Post400Code = (POST_400_CODES as readonly string[]).includes(mapped.code) ? (mapped.code as Post400Code) : "invalid-request";
        throw new HttpError(400, code, code === mapped.code ? mapped.message : MSG.generic);
      }

      requestId = newRequestId();
      if (!REQUEST_ID_RE.test(requestId)) throw new Error("request id is not well formed"); // it becomes a folder name
      if (parsed.value.savedPages.length > 0) await writeSavedPages(dataDir, requestId, parsed.value.savedPages);
      // The input is kept so a later approval can run the same job again (see approveRequest); the key is a public key, not a secret.
      const artifacts = [...(mapped.artifacts ?? []), { name: STORED_INPUT, text: JSON.stringify(mapped.input) }];
      {
        const { dropped } = await writeArtifacts(dataDir, requestId, artifacts);
        if (dropped.length > 0) logger.warn("request artifacts dropped", { requestId, dropped: dropped.length });
      }

      let handle;
      try {
        handle = await app.serviceFor(requestId).run({ operation: parsed.value.operation, input: mapped.input, jobId: requestId });
      } catch (e) {
        if (e instanceof InvalidInputError) throw new HttpError(400, "invalid-request", MSG.generic);
        throw e;
      }
      await saveMeta({ requestId, siteId: claims.siteId, createdAt: new Date(now()).toISOString() });
      accepted = true;
      const id = requestId;
      const site = claims.siteId;
      const task = handle.done
        .catch((e: unknown) => {
          crashed.add(id);
          logger.error("request crashed", { requestId: id, error: e instanceof Error ? e.name : "unknown" });
        })
        .finally(() => {
          setOpen(site, -1);
          background.delete(task);
        });
      background.add(task);
      logger.info("request accepted", { requestId: id, siteId: site });
      send(req, res, 202, { requestId: id, status: "queued" });
    } catch (e) {
      if (!accepted) {
        setOpen(claims.siteId, -1);
        if (requestId) {
          await removeSavedPages(dataDir, requestId).catch(() => undefined);
          await rm(join(requestsDir(dataDir), requestId), { recursive: true, force: true }).catch(() => undefined);
        }
      }
      throw e;
    }
  };

  const publicStatus = (job: Job | null, id: string): PublicStatus => {
    if (crashed.has(id)) return "failed";
    if (!job) return "queued";
    if (job.status === "awaiting-approval") return "needs-confirmation";
    if (job.status === "running") {
      // Before the confirm step has finished, the request is still being read and checked against the page.
      const confirms = app.requests.stepKinds(job.operation).includes("confirm");
      return confirms && !job.completedSteps.some((s) => stepKind(s) === "confirm") ? "interpreting" : "running";
    }
    return job.status;
  };

  const testTagsFor = async (job: Job): Promise<string[]> => {
    const mapper = app.httpOperations.get(job.operation);
    if (!mapper) return [];
    try {
      const body = await app.requests.publishedText(job, mapper.testTagsFile);
      return body ? mapper.testTags(body) : [];
    } catch {
      return [];
    }
  };

  /** What the request asked for that the published result leaves out; empty when the operation does not say. */
  const leftOutFor = async (job: Job): Promise<string[]> => {
    const mapper = app.httpOperations.get(job.operation);
    if (!mapper?.leftOut) return [];
    try {
      const text = await app.requests.publishedText(job, mapper.leftOutFile ?? "notes.md");
      return text ? mapper.leftOut(text).slice(0, 8) : [];
    } catch {
      return [];
    }
  };

  const getRequest = async (req: IncomingMessage, res: ServerResponse, claims: TokenClaims, id: string) => {
    const meta = REQUEST_ID_RE.test(id) ? await loadMeta(id) : null;
    // Other sites' requests look exactly like unknown ones.
    if (!meta || meta.siteId !== claims.siteId) throw new HttpError(404, "not-found", MSG.notFound);
    const job = await app.requests.job(id);
    const status = publicStatus(job, id);
    const body: Record<string, unknown> = {
      requestId: id,
      status,
      message: statusMessage(status, job, job ? app.httpOperations.get(job.operation) : undefined),
      updatedAt: job?.updatedAt ?? meta.createdAt,
      ...(app.notifierDelivery ? { confirmationDelivery: app.notifierDelivery } : {}),
    };
    if (status === "failed") body.code = crashed.has(id) || !job ? "internal" : failureCode(job.failure);
    if (status === "needs-confirmation" && job?.state.confirmation) {
      // What we understood (built by the operation from the checked interpretation and the real page) and the interpretation it describes,
      // which the requester sends back with the approval.
      body.understanding = job.state.confirmation.summary;
      body.interpretation = job.state.confirmation.proposed;
    }
    if (status === "succeeded" && job?.state.published) {
      const p = job.state.published;
      body.scriptUrl = config.scriptUrlBase ? `${config.scriptUrlBase}/${p.key}` : p.url;
      body.testTags = await testTagsFor(job);
      body.leftOut = await leftOutFor(job);
    }
    send(req, res, 200, body);
  };

  const approving = new Set<string>();

  /**
   * POST /v1/requests/:id/approve. Only a request that paused as "awaiting-approval" can be approved, once. The body carries the
   * interpretation the requester approved (answers to the questions applied). The same job runs again with that approval in its input;
   * the confirm step checks it against the page as it is NOW and against what the requester was shown, and refuses if either changed.
   */
  const approveRequest = async (req: IncomingMessage, res: ServerResponse, claims: TokenClaims, id: string) => {
    const meta = REQUEST_ID_RE.test(id) ? await loadMeta(id) : null;
    if (!meta || meta.siteId !== claims.siteId) throw new HttpError(404, "not-found", MSG.notFound);
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "unsupported-media-type", MSG.notJson);
    if (approving.has(id)) throw new HttpError(409, "not-awaiting-approval", MSG.notAwaiting);
    approving.add(id);
    let started = false;
    try {
      const raw = await readBody(req, res);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new HttpError(400, "invalid-request", MSG.badJson);
      }
      if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) throw new HttpError(400, "invalid-approval", MSG.approval);
      const job = await app.requests.job(id);
      if (!job || job.status !== "awaiting-approval") throw new HttpError(409, "not-awaiting-approval", MSG.notAwaiting);
      const mapper = app.httpOperations.get(job.operation);
      if (!mapper?.approve) throw new HttpError(409, "not-awaiting-approval", MSG.notAwaiting);
      let stored: Record<string, unknown>;
      try {
        stored = JSON.parse(await readFile(join(requestsDir(dataDir), id, STORED_INPUT), "utf8")) as Record<string, unknown>;
      } catch {
        throw new HttpError(409, "not-awaiting-approval", MSG.notAwaiting);
      }
      const approved = mapper.approve(stored, parsedJson as Record<string, unknown>);
      if (!approved.ok) throw new HttpError(400, "invalid-approval", MSG.approval);
      if ((openBySite.get(claims.siteId) ?? 0) >= config.maxOpenJobsPerSite) throw new HttpError(429, "cap-open-requests", MSG.tooManyOpen, { "Retry-After": "30" });
      let handle;
      try {
        handle = await app.serviceFor(id).run({ operation: job.operation, input: approved.input, jobId: id });
      } catch (e) {
        if (e instanceof InvalidInputError) throw new HttpError(400, "invalid-approval", MSG.approval);
        throw e;
      }
      started = true;
      const site = claims.siteId;
      setOpen(site, 1);
      const task = handle.done
        .catch((e: unknown) => {
          crashed.add(id);
          logger.error("request crashed", { requestId: id, error: e instanceof Error ? e.name : "unknown" });
        })
        .finally(() => {
          setOpen(site, -1);
          approving.delete(id);
          background.delete(task);
        });
      background.add(task);
      logger.info("request approved", { requestId: id, siteId: site });
      send(req, res, 202, { requestId: id, status: "approved" });
    } finally {
      if (!started) approving.delete(id);
    }
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const method = req.method ?? "GET";
      if (method === "OPTIONS") {
        res.writeHead(204, { ...corsHeaders(req), "Cache-Control": "no-store" });
        res.end();
        return;
      }
      if (path === "/healthz") {
        if (method !== "GET") throw new HttpError(405, "method-not-allowed", MSG.methodNotAllowed, { Allow: "GET" });
        return send(req, res, 200, { ok: true });
      }
      if (path === "/v1/requests") {
        if (method !== "POST") throw new HttpError(405, "method-not-allowed", MSG.methodNotAllowed, { Allow: "POST" });
        return await createRequest(req, res, authenticate(req));
      }
      const ap = /^\/v1\/requests\/([^/]+)\/approve$/.exec(path);
      if (ap) {
        if (method !== "POST") throw new HttpError(405, "method-not-allowed", MSG.methodNotAllowed, { Allow: "POST" });
        return await approveRequest(req, res, authenticate(req), ap[1]!);
      }
      const m = /^\/v1\/requests\/([^/]+)$/.exec(path);
      if (m) {
        if (method !== "GET") throw new HttpError(405, "method-not-allowed", MSG.methodNotAllowed, { Allow: "GET" });
        return await getRequest(req, res, authenticate(req), m[1]!);
      }
      throw new HttpError(404, "not-found", MSG.routeNotFound);
    } catch (e) {
      if (e instanceof HttpError) return send(req, res, e.status, { error: { code: e.code, message: e.publicMessage } }, e.headers);
      logger.error("unhandled error", { error: e instanceof Error ? e.name : "unknown" });
      send(req, res, 500, { error: { code: "internal", message: MSG.internal } });
    }
  };

  return { handler, whenIdle: async () => void (await Promise.all([...background])) };
}

export async function startHttpServer(opts: HttpServerOptions): Promise<RunningHttpServer> {
  await recoverInterruptedJobs({ markInterrupted: opts.app.requests.markInterrupted, dataDir: opts.dataDir, nowIso: new Date((opts.now ?? Date.now)()).toISOString(), logger: opts.logger });
  const { handler, whenIdle } = createRequestHandler(opts);
  const server = createServer((req, res) => void handler(req, res));
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.config.port, opts.config.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.config.port;
  return {
    server,
    port,
    url: `http://${opts.config.host}:${port}`,
    whenIdle,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
