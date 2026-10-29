/**
 * Shared local pipeline smoke: POST saved HTML, poll to success, fetch published script.
 * Used by scripts/smoke-local.ts (ephemeral ports) and tools/local/smoke-against-stack.ts (fixed ports).
 */
import { storageDir } from "../../src/domain/data-layout.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadHttpConfig } from "../../src/entrypoints/http/config.ts";
import { startHttpServer } from "../../src/entrypoints/http/server.ts";
import { buildApp, type Overrides } from "../../src/composition/wire.ts";
import { NullLogger } from "../../src/adapters/system.ts";
import { startScriptsHost, type RunningScriptsHost } from "./scripts-host/server.ts";
import type { Logger } from "../../src/ports/index.ts";

export interface InProcessSmokeStack {
  dataDir: string;
  scripts: RunningScriptsHost;
  http: { url: string; close(): Promise<void> };
  /** The in-process app, so tests and the transcript batch can read a failed job's own reason (HTTP shows only generic text). */
  app: Awaited<ReturnType<typeof buildApp>>;
}

export async function startInProcessSmokeStack(opts: {
  rootDir: string;
  dataDir: string;
  manifestPath: string;
  tokenSecret: string;
  logger?: Logger;
  /** Fixed clock for tests (must match signToken `now` when using test tokens). */
  nowMs?: () => number;
  /** Adapter overrides (tests: for example a stand-in for the interpreter agent). */
  overrides?: Overrides;
}): Promise<InProcessSmokeStack> {
  const logger = opts.logger ?? new NullLogger();
  const scripts = await startScriptsHost({
    host: "127.0.0.1",
    port: 0,
    storageRoot: storageDir(opts.dataDir),
    corsOrigins: ["http://127.0.0.1:5173"],
  });
  const app = await buildApp({
    rootDir: opts.rootDir,
    dataDir: opts.dataDir,
    manifestPath: opts.manifestPath,
    overrides: { logger, ...(opts.overrides ?? {}) },
  });
  const httpCfg = loadHttpConfig({
    HEATMAP_TOKEN_SECRET: opts.tokenSecret,
    HEATMAP_HTTP_PORT: "0",
    HEATMAP_SCRIPT_URL_BASE: scripts.url,
    HEATMAP_RATE_LIMIT_PER_MIN: "1000",
  });
  const http = await startHttpServer({ app, config: httpCfg, dataDir: opts.dataDir, logger, now: opts.nowMs ?? (() => Date.now()) });
  return { dataDir: opts.dataDir, scripts, http, app };
}

export interface SmokeRunInput {
  apiBase: string;
  token: string;
  prompt: string;
  pageUrl: string;
  publicKey: string;
  html: string;
  expectedScriptOrigin?: string;
  pollMs?: number;
  maxPolls?: number;
}

export interface SmokeRunResult {
  ok: true;
  requestId: string;
  scriptUrl: string;
  testTags: unknown;
}

export async function pollRequestSuccess(input: {
  apiBase: string;
  token: string;
  requestId: string;
  expectedScriptOrigin?: string;
  pollMs?: number;
  maxPolls?: number;
}): Promise<SmokeRunResult | { ok: false; reason: string }> {
  const max = input.maxPolls ?? 120;
  const wait = input.pollMs ?? 50;
  const base = input.apiBase.replace(/\/+$/, "");
  let view: Record<string, unknown> | undefined;
  for (let i = 0; i < max; i++) {
    const res = await fetch(`${base}/v1/requests/${input.requestId}`, {
      headers: { Authorization: `Bearer ${input.token}` },
    });
    view = (await res.json()) as Record<string, unknown>;
    if (view.status === "succeeded" || view.status === "failed") break;
    await new Promise((r) => setTimeout(r, wait));
  }
  if (view?.status !== "succeeded") {
    return { ok: false, reason: `pipeline did not succeed: ${JSON.stringify(view)}` };
  }
  const scriptUrl = String(view.scriptUrl ?? "");
  if (input.expectedScriptOrigin && !scriptUrl.startsWith(input.expectedScriptOrigin.replace(/\/+$/, ""))) {
    return { ok: false, reason: `scriptUrl not on scripts host: ${scriptUrl}` };
  }
  const scriptRes = await fetch(scriptUrl);
  if (!scriptRes.ok) {
    return { ok: false, reason: `could not fetch script: ${scriptRes.status}` };
  }
  const script = await scriptRes.text();
  if (!script.includes("_fireCustomEvent")) {
    return { ok: false, reason: "published script missing Heatmap transport (_fireCustomEvent)" };
  }
  return { ok: true, requestId: input.requestId, scriptUrl, testTags: view.testTags };
}

export async function runSmokePipeline(input: SmokeRunInput): Promise<SmokeRunResult | { ok: false; reason: string }> {
  const body = {
    prompt: input.prompt,
    pageUrls: [input.pageUrl],
    publicKey: input.publicKey,
    savedPages: [{ url: input.pageUrl, html: input.html }],
  };
  const created = await fetch(`${input.apiBase.replace(/\/+$/, "")}/v1/requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (created.status !== 202) {
    return { ok: false, reason: `create failed ${created.status}: ${await created.text()}` };
  }
  const { requestId } = (await created.json()) as { requestId: string };
  return pollRequestSuccess({
    apiBase: input.apiBase,
    token: input.token,
    requestId,
    expectedScriptOrigin: input.expectedScriptOrigin,
    pollMs: input.pollMs,
    maxPolls: input.maxPolls,
  });
}

export async function readFixtureHtml(rootDir: string, relativePath: string): Promise<string> {
  return readFile(join(rootDir, relativePath), "utf8");
}

export const DEFAULT_SMOKE_PROMPT =
  "Tag faq_opened when a visitor opens any FAQ, and scrolled_50_percent when they scroll halfway down the page.";
