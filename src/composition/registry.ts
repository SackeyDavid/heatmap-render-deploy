import { storageDir } from "../domain/data-layout.ts";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { requestPagesDir } from "../domain/request-id.ts";
import { ConfigError } from "../domain/errors.ts";
import { ClaudeCodeAgent } from "../adapters/agents/claude-code/claude-code-agent.ts";
import { DisabledAgent } from "../adapters/agents/disabled/disabled-agent.ts";
import { LiveFetchInspector } from "../adapters/inspector/live-fetch/live-fetch-inspector.ts";
import { OpenRouterAgent, type ProviderModel } from "../adapters/agents/openrouter/openrouter-agent.ts";
import { FakeAgent } from "../adapters/agents/fake/fake-agent.ts";
import { FixtureContextPackSource } from "../adapters/context-pack/fixture-context-pack.ts";
import { FixturePageInspector } from "../adapters/inspector/fixture-inspector.ts";
import { SavedHtmlInspector } from "../adapters/inspector/saved-html/saved-html-inspector.ts";
import { FileJobStore, InMemoryJobStore } from "../adapters/jobs/job-stores.ts";
import { ConsoleNotifier, InMemoryNotifier } from "../adapters/notifier/notifiers.ts";
import { SmtpNotifier } from "../adapters/notifier/smtp-notifier.ts";
import { LocalFsStorage } from "../adapters/storage/local-fs/local-fs-storage.ts";
import { S3RemoteStorage } from "../adapters/storage/s3/s3-remote-storage.ts";
import { loadS3Config, loadSmtpConfig } from "./plug-in-env.ts";
import { LocalFsWorkspace } from "../adapters/storage/local-fs/local-fs-workspace.ts";
import type {
  AgentRunner,
  ContextPackSource,
  JobStore,
  Notifier,
  PageInspector,
  RemoteStorage,
  Workspace,
} from "../ports/index.ts";
import type { Env } from "./plugin.ts";

type Factory<T> = (env: Env, config: Record<string, unknown>) => T;

/**
 * Marks an adapter that must never run in production (a fake, console output, in-memory state, repo fixtures).
 * The mark sits on the factory, next to the adapter's one declaration, and wire.ts rejects it at startup in
 * production mode, naming the binding.
 */
const localOnly = <T>(factory: Factory<T>): Factory<T> => Object.assign(factory, { localOnly: true as const });
type RequestScopedFactory<T> = Factory<T> & { forRequest: (env: Env, config: Record<string, unknown>, requestId: string) => T };
/** An adapter that can also be built for one request (its own scope). The registry entry owns how; composition only asks. */
const requestScoped = <T>(factory: Factory<T>, forRequest: RequestScopedFactory<T>["forRequest"]): RequestScopedFactory<T> => Object.assign(factory, { forRequest });
/** The adapter built for one request, or undefined when this adapter has no per-request scope. */
export const requestScopedPageInspector = (name: string, env: Env, config: Record<string, unknown>, requestId: string): PageInspector | undefined =>
  (registry.pageInspector as Record<string, Partial<RequestScopedFactory<PageInspector>>>)[name]?.forRequest?.(env, config, requestId);
const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
/** A manifest setting that names a folder (relative to the repo root): must be a string and an existing folder, or startup fails naming it. */
const folderSetting = (where: string, e: Env, value: unknown): string => {
  if (typeof value !== "string" || value === "") throw new ConfigError([`${where}: must be a folder path (a string)`]);
  const path = resolve(e.rootDir, value);
  if (!isDirectory(path)) throw new ConfigError([`${where}: "${value}" is not an existing folder`]);
  return path;
};
/** Optional size limits for saved pages, declared in the manifest; each must be a positive whole number. */
/**
 * The `providerModels` list of an OpenRouterAgent entry: models on providers that speak the same chat format (Groq, ...).
 * Each names its own key variable (`keyEnv`). A provider whose key is not set is left out, so a manifest can name Groq
 * before the key exists on a server and the app still reads through OpenRouter.
 */
const providerModelsFrom = (where: string, value: unknown, vars: Record<string, string | undefined>): ProviderModel[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError([`${where}.providerModels: must be a list`]);
  const out: ProviderModel[] = [];
  for (const [i, raw] of value.entries()) {
    const at = `${where}.providerModels[${i}]`;
    const m = (raw ?? {}) as Record<string, unknown>;
    if (typeof m.model !== "string" || m.model === "") throw new ConfigError([`${at}.model: must be a model id (a string)`]);
    if (typeof m.endpoint !== "string" || !/^https:\/\/[^\s]+$/.test(m.endpoint)) throw new ConfigError([`${at}.endpoint: must be a full https address`]);
    if (typeof m.keyEnv !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(m.keyEnv)) throw new ConfigError([`${at}.keyEnv: must be the name of an environment variable, e.g. GROQ_API_KEY`]);
    if (m.label !== undefined && (typeof m.label !== "string" || !/^[A-Za-z][A-Za-z0-9 ._-]{0,29}$/.test(m.label))) throw new ConfigError([`${at}.label: must be a short plain name`]);
    const apiKey = vars[m.keyEnv]?.trim();
    if (apiKey) out.push({ model: m.model, endpoint: m.endpoint, apiKey, label: (m.label as string | undefined) ?? m.keyEnv });
    else console.warn(`${at}: ${m.keyEnv} is not set, so ${m.model} is skipped`);
  }
  return out;
};

/** `liveFetch: true` on a saved-html binding: when the request has no saved copy of an address, the real page is read from the web (https only, public addresses only). */
const withLiveFetch = (c: Record<string, unknown>, inner: PageInspector): PageInspector => {
  if (c.liveFetch === undefined || c.liveFetch === false) return inner;
  if (c.liveFetch !== true) throw new ConfigError(["bindings.pageInspector.liveFetch: must be true or false"]);
  return new LiveFetchInspector({ inner, ...inspectorLimits(c) });
};

const inspectorLimits = (c: Record<string, unknown>): { maxHtmlBytes?: number; maxControls?: number } => {
  const out: { maxHtmlBytes?: number; maxControls?: number } = {};
  for (const key of ["maxHtmlBytes", "maxControls"] as const) {
    if (c[key] === undefined) continue;
    if (typeof c[key] !== "number" || !Number.isInteger(c[key]) || (c[key] as number) <= 0) throw new ConfigError([`bindings.pageInspector.${key}: must be a whole number above 0`]);
    out[key] = c[key] as number;
  }
  return out;
};
/** Read-only page folders tried after a request's own, declared in the manifest (paths relative to the repo root). */
const fallbackRoots = (e: Env, c: Record<string, unknown>): string[] | undefined => {
  if (c.fallbackRoots === undefined) return undefined;
  if (!Array.isArray(c.fallbackRoots)) throw new ConfigError(["bindings.pageInspector: fallbackRoots must be a list of folder paths"]);
  return c.fallbackRoots.map((x, i) => folderSetting(`bindings.pageInspector.fallbackRoots[${i}]`, e, x));
};

/** A fact an adapter declares about itself next to its factory: mail through it is not really delivered. */
const prints = <T>(factory: Factory<T>): Factory<T> => Object.assign(factory, { delivery: "console" as const });
export const notifierDelivery = (name: string): "console" | undefined => ((registry.notifier as Record<string, { delivery?: "console" }>)[name]?.delivery);

export const isLocalOnly = (factory: unknown): boolean => (factory as { localOnly?: unknown } | undefined)?.localOnly === true;

/** Framework-owned adapters, by name. Operation-specific adapters come from plugins instead. */
export const registry = {
  /** Agent adapters by the `adapter:` name used in the manifest's `agents:` block. */
  agents: {
    FakeAgent: localOnly<AgentRunner>((env, c) => {
      let when: Record<string, Record<string, string>> | undefined;
      if (c.outputsWhen !== undefined) {
        const raw = c.outputsWhen;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ConfigError(["agents: outputsWhen must be a map of job fact -> value -> folder"]);
        when = {};
        for (const [key, byValue] of Object.entries(raw)) {
          if (typeof byValue !== "object" || byValue === null || Array.isArray(byValue)) throw new ConfigError([`agents: outputsWhen.${key} must be a map of value -> folder`]);
          when[key] = Object.fromEntries(Object.entries(byValue).map(([v, dir]) => [v, folderSetting(`agents: outputsWhen.${key}.${v}`, env, dir)]));
        }
      }
      return new FakeAgent({
        fixtureDir: c.outputsFrom !== undefined ? folderSetting("agents: outputsFrom", env, c.outputsFrom) : undefined,
        fixtureDirWhen: when,
      });
    }),
    ClaudeCodeRunner: ((_env, c) => {
      const where = "agents: ClaudeCodeRunner";
      if (c.binary !== undefined && (typeof c.binary !== "string" || c.binary === "")) throw new ConfigError([`${where}.binary: must be the name or path of the claude program (a string)`]);
      if (c.allowedTools !== undefined && (!Array.isArray(c.allowedTools) || c.allowedTools.length === 0 || !c.allowedTools.every((t) => typeof t === "string" && t !== ""))) {
        throw new ConfigError([`${where}.allowedTools: must be a non-empty list of tool names`]);
      }
      if (c.maxBudgetUsd !== undefined && (typeof c.maxBudgetUsd !== "number" || !(c.maxBudgetUsd > 0))) throw new ConfigError([`${where}.maxBudgetUsd: must be a number above 0 (US dollars per run)`]);
      return new ClaudeCodeAgent({
        binary: c.binary as string | undefined,
        allowedTools: c.allowedTools as string[] | undefined,
        maxBudgetUsd: c.maxBudgetUsd as number | undefined,
      });
    }) as Factory<AgentRunner>,
    /** Reads a request through OpenRouter (free models only unless the manifest says allowPaid). The key comes from OPENROUTER_API_KEY, never from the manifest. `providerModels` (Groq and similar) are tried first, each with the key named in its `keyEnv`. */
    OpenRouterAgent: ((env, c) => {
      const where = "agents: OpenRouterAgent";
      const key = (env.vars ?? process.env).OPENROUTER_API_KEY?.trim();
      if (!key) throw new ConfigError([`${where}: set OPENROUTER_API_KEY (an OpenRouter API key) in the environment`]);
      if (typeof c.model !== "string" || c.model === "") throw new ConfigError([`${where}.model: must be an OpenRouter model id (a string), e.g. nvidia/nemotron-3.5-super-vl:free`]);
      if (c.fallbackModels !== undefined && (!Array.isArray(c.fallbackModels) || !c.fallbackModels.every((m) => typeof m === "string" && m !== ""))) {
        throw new ConfigError([`${where}.fallbackModels: must be a list of OpenRouter model ids`]);
      }
      if (c.maxTokens !== undefined && (typeof c.maxTokens !== "number" || !Number.isInteger(c.maxTokens) || c.maxTokens < 100)) throw new ConfigError([`${where}.maxTokens: must be a whole number of at least 100`]);
      if (c.allowPaid !== undefined && typeof c.allowPaid !== "boolean") throw new ConfigError([`${where}.allowPaid: must be true or false`]);
      const models = [c.model, ...((c.fallbackModels as string[] | undefined) ?? [])];
      const paid = models.filter((m) => !m.endsWith(":free"));
      if (paid.length > 0 && c.allowPaid !== true) throw new ConfigError([`${where}: ${paid.join(", ")} is not a free model (free ids end in ":free"). Use a free model, or set allowPaid: true to accept the cost`]);
      const vars = env.vars ?? process.env;
      const providerModels = providerModelsFrom(where, c.providerModels, vars);
      return new OpenRouterAgent({ apiKey: key, model: c.model, fallbackModels: c.fallbackModels as string[] | undefined, providerModels, maxTokens: c.maxTokens as number | undefined, allowPaid: c.allowPaid === true });
    }) as Factory<AgentRunner>,
    /** Declares "no agent here": the manifest binds it where a real agent could otherwise run. */
    DisabledAgent: (() => new DisabledAgent()) as Factory<AgentRunner>,
  },
  remoteStorage: {
    "local-fs": ((e) => new LocalFsStorage(storageDir(e.dataDir))) as Factory<RemoteStorage>,
    s3: ((e) => new S3RemoteStorage(loadS3Config(e.vars ?? process.env))) as Factory<RemoteStorage>,
  },
  workspace: {
    "local-fs": ((e) => new LocalFsWorkspace(join(e.dataDir, "work"))) as Factory<Workspace>,
  },
  pageInspector: {
    fixture: localOnly<PageInspector>((e) => new FixturePageInspector(join(e.rootDir, "fixtures", "pages"))),
    "saved-html": requestScoped<PageInspector>(
      (e, c) => withLiveFetch(c, new SavedHtmlInspector({ root: c.root !== undefined ? folderSetting("bindings.pageInspector.root", e, c.root) : join(e.dataDir, "pages"), fallbackRoots: fallbackRoots(e, c), ...inspectorLimits(c) })),
      // One folder of saved pages per request, so a request can only ever read the pages it uploaded (plus declared fallbacks).
      (e, c, requestId) => withLiveFetch(c, new SavedHtmlInspector({ root: requestPagesDir(e.dataDir, requestId), fallbackRoots: fallbackRoots(e, c), ...inspectorLimits(c) })),
    ),
  },
  contextPack: {
    fixture: ((e) => new FixtureContextPackSource(join(e.rootDir, "fixtures", "context"))) as Factory<ContextPackSource>,
  },
  jobStore: {
    file: ((e) => new FileJobStore(join(e.dataDir, "jobs"))) as Factory<JobStore>,
    "in-memory": localOnly<JobStore>(() => new InMemoryJobStore()),
  },
  notifier: {
    console: prints(localOnly<Notifier>(() => new ConsoleNotifier())),
    "in-memory": localOnly<Notifier>(() => new InMemoryNotifier()),
    smtp: ((e) => new SmtpNotifier(loadSmtpConfig(e.vars ?? process.env))) as Factory<Notifier>,
  },
};

/** Config keys each agent adapter reads from its manifest block (besides `adapter`). Unknown keys fail at startup. */
export const AGENT_CONFIG_KEYS: Record<keyof typeof registry.agents, readonly string[]> = {
  FakeAgent: ["outputsFrom", "outputsWhen"],
  ClaudeCodeRunner: ["binary", "allowedTools", "maxBudgetUsd"],
  OpenRouterAgent: ["model", "fallbackModels", "providerModels", "maxTokens", "allowPaid"],
  DisabledAgent: [],
};

/** Settings each binding adapter reads when the manifest writes the binding as `{ adapter, ...settings }`. Anything else is a startup error. */
export const BINDING_CONFIG_KEYS: Partial<Record<keyof typeof registry, Record<string, readonly string[]>>> = {
  pageInspector: { "saved-html": ["root", "fallbackRoots", "maxHtmlBytes", "maxControls", "liveFetch"] },
};

/** Step kinds and their config schemas are declared once, in step-schemas.ts. */
export { KNOWN_STEP_KINDS } from "./step-schemas.ts";
