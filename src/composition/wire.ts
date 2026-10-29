import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ConsoleLogger, randomIdGen, systemClock } from "../adapters/system.ts";
import type { PipelineBreakpointControl } from "../application/pipeline-breakpoints.ts";
import { createBreakpointsFromEnv } from "./breakpoints-env.ts";
import { OperationService, type RegisteredOperation } from "../application/operation-service.ts";
import { PipelineRunner } from "../application/pipeline-runner.ts";
import { ConfigError } from "../domain/errors.ts";
import type { Job } from "../domain/types.ts";
import { markInterrupted } from "../application/mark-interrupted.ts";
import { siblingKey } from "../domain/published-key.ts";
import { REQUEST_ID_RE } from "../domain/request-id.ts";
import type {
  AgentRunner,
  Clock,
  ContextPackSource,
  IdGen,
  JobStore,
  Logger,
  Notifier,
  OperationRequestMapper,
  PageInspector,
  QualityGate,
  RemoteStorage,
  RunOperation,
  Verifier,
  Workspace,
} from "../ports/index.ts";
import { loadManifest } from "./manifest.ts";
import type { CreatePlugin, Env, OperationPlugin } from "./plugin.ts";
import { AGENT_CONFIG_KEYS, BINDING_CONFIG_KEYS, notifierDelivery, registry, requestScopedPageInspector } from "./registry.ts";
import { productionGuardProblems } from "./production-guard.ts";
import { validateSteps } from "./step-schemas.ts";

export interface Overrides {
  agents?: Record<string, AgentRunner>;
  storage?: RemoteStorage;
  workspace?: Workspace;
  inspector?: PageInspector;
  contextPack?: ContextPackSource;
  jobStore?: JobStore;
  notifier?: Notifier;
  clock?: Clock;
  idGen?: IdGen;
  logger?: Logger;
  breakpoints?: PipelineBreakpointControl;
}


export interface App {
  service: RunOperation;
  /** A service whose page inspector is scoped to one request, when the bound inspector supports that (saved-html does). */
  serviceFor(requestId: string): RunOperation;
  /** Operations the manifest declares that a plugin can map HTTP requests for, in manifest order. Others are not served over HTTP. */
  httpOperations: ReadonlyMap<string, OperationRequestMapper>;
  /** What the bound notifier does with mail, when that is not real delivery ("console": it prints to the terminal). Undefined for a real or overridden notifier. */
  notifierDelivery?: "console";
  /**
   * What a transport needs to answer "how is my request doing?", and nothing else. Entrypoints use this, never `ports`
   * (a test keeps `.ports.` out of src/entrypoints).
   */
  logger: Logger;
  requests: {
    /** The job with this id, or null. */
    job(id: string): Promise<Job | null>;
    /** Text of a file the job published next to its script (same folder), or null. */
    publishedText(job: Job, fileName: string): Promise<string | null>;
    /** The step kinds the operation's manifest runs, in order (for example to tell whether it asks for approval). */
    stepKinds(operation: string): string[];
    /** Marks jobs left unfinished by a restart as failed; returns the ids changed. */
    markInterrupted(accepted: { id: string; createdAt: string }[], nowIso: string): Promise<string[]>;
  };
  /** The adapters this process was built with. For tests and operator scripts; HTTP and the CLI do not reach into it. */
  ports: {
    agents: Map<string, AgentRunner>;
    storage: RemoteStorage;
    jobStore: JobStore;
    notifier: Notifier;
  };
}

/** Finds plugin files in composition/plugins/. Deleting a file removes that operation's wiring. */
async function discoverPlugins(env: Env): Promise<OperationPlugin[]> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "plugins");
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".ts") || f.endsWith(".js")).sort();
  const plugins: OperationPlugin[] = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(dir, f)).href)) as { createPlugin?: CreatePlugin };
    if (typeof mod.createPlugin !== "function") throw new ConfigError([`plugins/${f} must export createPlugin()`]);
    plugins.push(mod.createPlugin(env));
  }
  return plugins;
}

/**
 * Composition root: the only module that picks adapters. Fails at startup on any inconsistency
 * between the manifest and what is available, never mid-job.
 */
export async function buildApp(opts: {
  rootDir: string;
  manifestPath?: string;
  dataDir?: string;
  /**
   * "production" refuses any local-only adapter, fake gate or verifier the manifest binds (startup ConfigError naming
   * the declaration). Defaults to "local", the CLI and test behaviour; the HTTP service passes its HEATMAP_MODE.
   */
  mode?: "local" | "production";
  /** Explicit plugin list (tests). Omit to discover plugins/*.ts. */
  plugins?: OperationPlugin[];
  overrides?: Overrides;
  /** Environment values plugins and adapter factories may read. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}): Promise<App> {
  const rootDir = resolve(opts.rootDir);
  const manifestPath = opts.manifestPath ?? join(rootDir, "manifests", "operations.yaml");
  const env: Env = { rootDir, dataDir: resolve(opts.dataDir ?? join(rootDir, ".out")), vars: opts.env ?? process.env };
  const manifest = await loadManifest(manifestPath);
  const ov = opts.overrides ?? {};
  const b = manifest.bindings;
  // An explicit plugin list IS the plugin set (tests inject their own); discovery runs only when none is given,
  // so a plugin is never registered twice and no later plugin silently replaces an earlier one.
  const plugins = opts.plugins ?? (await discoverPlugins(env));
  const problems: string[] = [];
  const hint = (name: string) => {
    const h = plugins.map((p) => p.hints?.[name]).find((x) => x !== undefined);
    return h ? ` (${h})` : "";
  };

  const pick = <T>(label: string, table: Record<string, (e: Env, c: Record<string, unknown>) => T>, name: string, config = {}): T | undefined => {
    const factory = Object.hasOwn(table, name) ? table[name] : undefined;
    if (!factory) {
      problems.push(`${label}: no adapter named "${name}" (available: ${[...Object.keys(table), ...(label.startsWith("agents.") ? pluginAgents.keys() : [])].join(", ")})`);
      return undefined;
    }
    return factory(env, config);
  };

  // Plugin agents by adapter name: own properties only, no duplicates between plugins, no shadowing of a registry adapter.
  const pluginAgents = new Map<string, (env: Env, config: Record<string, unknown>) => AgentRunner>();
  for (const p of plugins) {
    for (const [k, v] of Object.entries(p.agents ?? {})) {
      if (pluginAgents.has(k)) problems.push(`plugins: agent adapter "${k}" is provided by more than one plugin`);
      else if (Object.hasOwn(registry.agents, k)) problems.push(`plugins: agent adapter "${k}" has the same name as a built-in adapter`);
      else pluginAgents.set(k, v);
    }
  }
  const agents = new Map<string, AgentRunner>();
  for (const [id, def] of manifest.agents) {
    const allowedKeys = Object.hasOwn(AGENT_CONFIG_KEYS, def.adapter) ? (AGENT_CONFIG_KEYS as Record<string, readonly string[]>)[def.adapter] : undefined;
    if (allowedKeys) {
      for (const key of Object.keys(def.config)) {
        if (!allowedKeys.includes(key)) {
          problems.push(`agents.${id}: unknown key "${key}" for adapter ${def.adapter} (allowed: ${allowedKeys.join(", ") || "none"})`);
        }
      }
    }
    const fromPlugin = pluginAgents.get(def.adapter);
    const a = ov.agents?.[id] ?? (fromPlugin ? fromPlugin(env, def.config) : pick(`agents.${id}`, registry.agents, def.adapter, def.config));
    if (a) agents.set(id, a);
  }
  const gates = new Map<string, QualityGate>();
  const verifiers = new Map<string, Verifier>();
  const operationAdapters = new Map<string, OperationPlugin["operations"][string]>();
  const mappers = new Map<string, OperationRequestMapper>();
  for (const p of plugins) {
    for (const [k, v] of Object.entries(p.gates)) {
      if (gates.has(k)) problems.push(`plugins: gate "${k}" is provided by more than one plugin`);
      gates.set(k, v);
    }
    for (const [k, v] of Object.entries(p.verifiers)) {
      if (verifiers.has(k)) problems.push(`plugins: verifier "${k}" is provided by more than one plugin`);
      verifiers.set(k, v);
    }
    for (const [k, v] of Object.entries(p.operations)) {
      if (operationAdapters.has(k)) problems.push(`plugins: operation adapter "${k}" is provided by more than one plugin`);
      operationAdapters.set(k, v);
    }
    for (const [k, v] of Object.entries(p.http?.requestMappers ?? {})) {
      if (mappers.has(k)) problems.push(`plugins: request mapper for operation "${k}" is provided by more than one plugin`);
      mappers.set(k, v);
    }
  }

  for (const [binding, config] of Object.entries(manifest.bindingConfig)) {
    const adapter = manifest.bindings[binding as keyof typeof manifest.bindings];
    const allowed = (BINDING_CONFIG_KEYS as Record<string, Record<string, readonly string[]> | undefined>)[binding]?.[adapter] ?? [];
    for (const key of Object.keys(config ?? {})) {
      if (!allowed.includes(key)) problems.push(`bindings.${binding}: unknown setting "${key}" for adapter ${adapter} (allowed: ${allowed.join(", ") || "none"})`);
    }
  }

  const storage = ov.storage ?? pick("bindings.remoteStorage", registry.remoteStorage, b.remoteStorage);
  const workspace = ov.workspace ?? pick("bindings.workspace", registry.workspace, b.workspace);
  const inspector = ov.inspector ?? pick("bindings.pageInspector", registry.pageInspector, b.pageInspector, manifest.bindingConfig.pageInspector ?? {});
  const contextPack = ov.contextPack ?? pick("bindings.contextPack", registry.contextPack, b.contextPack);
  const jobStore = ov.jobStore ?? pick("bindings.jobStore", registry.jobStore, b.jobStore);
  const notifier = ov.notifier ?? pick("bindings.notifier", registry.notifier, b.notifier);

  const operations = new Map<string, RegisteredOperation>();
  for (const [name, def] of manifest.operations) {
    const makeOperation = operationAdapters.get(def.adapter);
    if (!makeOperation) {
      problems.push(`operations.${name}.adapter: no operation adapter named "${def.adapter}"${hint(def.adapter)} (available: ${[...operationAdapters.keys()].join(", ") || "none"})`);
    }
    // Kinds, config keys and types, and step order come from the one step table (step-schemas.ts).
    problems.push(...validateSteps(name, def.steps));
    // Cross-references: what a step names must exist.
    for (const [i, step] of def.steps.entries()) {
      const where = `operations.${name}.steps[${i}] (${step.kind})`;
      if (step.kind === "confirm") {
        const id = step.config.interpreter;
        if (typeof id === "string" && !agents.has(id)) problems.push(`${where}: interpreter "${id}" is not declared under agents:`);
      }
      if (step.kind === "generate" || step.kind === "qa") {
        for (const key of ["agent", "fallback"] as const) {
          const id = step.config[key];
          if (typeof id === "string" && !agents.has(id)) problems.push(`${where}: ${key} "${id}" is not declared under agents:`);
        }
      }
      if (step.kind === "qa") {
        const wanted = Array.isArray(step.config.gates) ? step.config.gates.map(String) : [];
        for (const g of wanted) if (!gates.has(g)) problems.push(`${where}: gate "${g}" is not provided by any plugin${hint(g)}`);
      }
      if (step.kind === "verify") {
        const v = step.config.verifier;
        if (typeof v === "string" && !verifiers.has(v)) problems.push(`${where}: verifier "${v}" is not provided by any plugin${hint(v)}`);
      }
    }
    const generate = def.steps.find((s) => s.kind === "generate");
    if (!generate) problems.push(`operations.${name}: needs a generate step (its prompts are read from it)`);
    if (!makeOperation || !generate || typeof generate.config.prompt !== "string" || typeof generate.config.repairPrompt !== "string") continue;
    const promptPath = resolve(rootDir, generate.config.prompt);
    const repairPath = resolve(rootDir, String(generate.config.repairPrompt)); // required by the step schema: nothing is guessed from the generate prompt's folder
    try {
      const confirmStep = def.steps.find((st) => st.kind === "confirm");
      const interpretPath = typeof confirmStep?.config.interpretPrompt === "string" ? resolve(rootDir, confirmStep.config.interpretPrompt) : undefined;
      const prompts = {
        generate: await readFile(promptPath, "utf8"),
        repair: await readFile(repairPath, "utf8"),
        ...(interpretPath ? { interpret: await readFile(interpretPath, "utf8") } : {}),
      };
      const operation = makeOperation(prompts);
      if (operation.name !== name) {
        problems.push(`operations.${name}: the manifest key must equal the operation's own name "${operation.name}" (requests are routed by that name)`);
      } else {
        const known = new Set(["version", ...operation.templateVars]);
        const vars = (t: string) => [...t.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!);
        for (const [i, step] of def.steps.entries()) {
          const where = `operations.${name}.steps[${i}] (${step.kind})`;
          if (step.kind === "publish") {
            const key = String(step.config.key ?? "");
            const pointer = typeof step.config.pointer === "string" ? step.config.pointer : "";
            for (const [field, text] of [["key", key], ["pointer", pointer]] as const) {
              const unknown = vars(text).filter((v) => !known.has(v));
              if (unknown.length > 0) problems.push(`${where}: ${field} uses {${unknown.join("}, {")}} but this operation supplies only {${[...known].join("}, {")}}`);
            }
            if (!key.includes("{version}")) problems.push(`${where}: key must contain {version}, so each published script is a new, never-overwritten file`);
            if (pointer.includes("{version}")) problems.push(`${where}: pointer must not contain {version} (it is the one fixed address that moves to the newest version)`);
          }
          if (step.kind === "generate" && contextPack && typeof step.config.context === "string" && !(await contextPack.has(step.config.context))) {
            problems.push(`${where}: context pack "${step.config.context}" does not exist`);
          }
        }
        operations.set(name, { operation, steps: def.steps });
      }
    } catch (e) {
      problems.push(`operations.${name}: cannot read prompts (${(e as Error).message})`);
    }
  }

  // A job fact named in an agent's outputsWhen must be one some operation actually supplies, or it silently never matches.
  const supplied = new Set([...operations.values()].flatMap((o) => [...o.operation.templateVars]));
  for (const [id, def] of manifest.agents) {
    const when = def.config.outputsWhen;
    if (typeof when === "object" && when !== null && !Array.isArray(when) && supplied.size > 0) {
      for (const key of Object.keys(when)) {
        if (!supplied.has(key)) problems.push(`agents.${id}: outputsWhen key "${key}" is not a fact any operation supplies (known: ${[...supplied].join(", ")})`);
      }
    }
  }

  if (opts.mode === "production") problems.push(...productionGuardProblems(manifest, plugins, ov));
  if (problems.length > 0) throw new ConfigError(problems);

  const logger = ov.logger ?? new ConsoleLogger();
  const clock = ov.clock ?? systemClock;
  const idGen = ov.idGen ?? randomIdGen;
  const breakpoints = ov.breakpoints ?? createBreakpointsFromEnv(env.vars ?? process.env, logger);
  const pipelineBase = {
    agents,
    gates,
    verifiers,
    storage: storage!,
    contextPack: contextPack!,
    workspace: workspace!,
    jobStore: jobStore!,
    notifier: notifier!,
    clock,
    idGen,
    logger,
    breakpoints,
  };
  const makeService = (pageInspector: PageInspector) =>
    new OperationService(operations, new PipelineRunner({ ...pipelineBase, inspector: pageInspector }), idGen, logger);
  const defaultInspector = inspector!;
  const serviceFor = (requestId: string): RunOperation => {
    // The id becomes a folder name, so a malformed one never gets a service (no silent fallback to an unscoped inspector).
    if (!REQUEST_ID_RE.test(requestId)) throw new Error("serviceFor: the request id is not well formed");
    // An explicit inspector override wins; otherwise the registry entry says how to scope its adapter to this request.
    const scoped = ov.inspector ? undefined : requestScopedPageInspector(b.pageInspector, env, manifest.bindingConfig.pageInspector ?? {}, requestId);
    return makeService(scoped ?? defaultInspector);
  };
  const httpOperations = new Map<string, OperationRequestMapper>();
  for (const name of operations.keys()) {
    const mapper = mappers.get(name);
    if (mapper) httpOperations.set(name, mapper);
  }
  return {
    service: makeService(defaultInspector),
    serviceFor,
    httpOperations,
    ...(!ov.notifier && notifierDelivery(b.notifier) ? { notifierDelivery: notifierDelivery(b.notifier) } : {}),
    logger,
    requests: {
      job: (id) => jobStore!.get(id),
      publishedText: async (job, fileName) => {
        const key = job.state.published?.key;
        return key ? storage!.get(siblingKey(key, fileName)) : null;
      },
      stepKinds: (operation) => operations.get(operation)?.steps.map((st) => st.kind) ?? [],
      markInterrupted: (accepted, nowIso) => markInterrupted(jobStore!, accepted, nowIso),
    },
    ports: { agents, storage: storage!, jobStore: jobStore!, notifier: notifier! },
  };
}
