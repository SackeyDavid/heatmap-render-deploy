import type { Manifest } from "./manifest.ts";
import type { OperationPlugin } from "./plugin.ts";
import { isLocalOnly, registry } from "./registry.ts";

/**
 * In production mode a manifest may not bind anything marked local-only: a fake agent, console or in-memory
 * notifier or job store, the repo-fixture page inspector, or a plugin's fake gate or verifier. Returns one problem
 * per offending declaration, each naming where it is declared and what to use instead, so a deploy that would
 * silently run canned output fails at startup instead.
 */
/** Adapters that only make sense in production. A manifest binding one while HEATMAP_MODE is unset is refused: the mode must be said out loud. */
export function productionLikeBindings(manifest: Manifest): string[] {
  const found: string[] = [];
  if (manifest.bindings.remoteStorage === "s3") found.push("bindings.remoteStorage: s3");
  if (manifest.bindings.notifier === "smtp") found.push("bindings.notifier: smtp");
  return found;
}

/** The only overrides production accepts: they carry no adapter choice. Anything else would bypass the manifest and this guard. */
const PRODUCTION_SAFE_OVERRIDES: readonly string[] = ["logger", "clock", "idGen", "breakpoints"];

export function productionGuardProblems(manifest: Manifest, plugins: OperationPlugin[], overrides: object = {}): string[] {
  const problems: string[] = [];
  const refused = (where: string, what: string) => problems.push(`${where}: ${what} is local-only (a fake or local stand-in) and cannot run in production`);

  const b = manifest.bindings;
  for (const [label, table, name] of [
    ["remoteStorage", registry.remoteStorage, b.remoteStorage],
    ["workspace", registry.workspace, b.workspace],
    ["pageInspector", registry.pageInspector, b.pageInspector],
    ["contextPack", registry.contextPack, b.contextPack],
    ["jobStore", registry.jobStore, b.jobStore],
    ["notifier", registry.notifier, b.notifier],
  ] as const) {
    if (isLocalOnly((table as Record<string, unknown>)[name])) refused(`bindings.${label}`, `"${name}"`);
  }

  for (const key of Object.keys(overrides)) {
    if (!PRODUCTION_SAFE_OVERRIDES.includes(key)) {
      problems.push(`overrides.${key}: an injected adapter bypasses the manifest and this guard, so it cannot be used in production (allowed: ${PRODUCTION_SAFE_OVERRIDES.join(", ")})`);
    }
  }
  if ((manifest.bindingConfig.pageInspector?.fallbackRoots as unknown[] | undefined)?.length) {
    problems.push("bindings.pageInspector: fallbackRoots serves repo sample pages when a request has none (a local stand-in) and cannot run in production; remove it");
  }

  const localOperations = new Set(plugins.flatMap((p) => p.localOnly?.operations ?? []));
  const localGates = new Set(plugins.flatMap((p) => p.localOnly?.gates ?? []));
  const localVerifiers = new Set(plugins.flatMap((p) => p.localOnly?.verifiers ?? []));
  const referencedAgents = new Map<string, string>(); // agent id -> first step that uses it

  for (const [operation, def] of manifest.operations) {
    if (localOperations.has(def.adapter)) refused(`operations.${operation}`, `operation adapter "${def.adapter}"`);
    for (const [i, step] of def.steps.entries()) {
      const where = `operations.${operation}.steps[${i}] (${step.kind})`;
      for (const key of ["agent", "fallback", "interpreter"] as const) {
        const id = step.config[key];
        if (typeof id === "string" && !referencedAgents.has(id)) referencedAgents.set(id, where);
      }
      if (step.kind === "qa" && Array.isArray(step.config.gates)) {
        for (const g of step.config.gates.map(String)) if (localGates.has(g)) refused(where, `gate "${g}"`);
      }
      if (step.kind === "verify" && typeof step.config.verifier === "string" && localVerifiers.has(step.config.verifier)) {
        refused(where, `verifier "${step.config.verifier}"`);
      }
    }
  }

  // A real agent that costs money per run must have a cost cap declared in production.
  for (const [id, usedAt] of referencedAgents) {
    const def = manifest.agents.get(id);
    if (def?.adapter === "ClaudeCodeRunner" && def.config.maxBudgetUsd === undefined) {
      problems.push(`agents.${id}: ClaudeCodeRunner (used by ${usedAt}) needs maxBudgetUsd in production, so one run cannot spend without a limit`);
    }
    if (def?.adapter === "OpenRouterAgent") {
      const models = [def.config.model, ...(Array.isArray(def.config.fallbackModels) ? def.config.fallbackModels : [])].filter((m): m is string => typeof m === "string");
      const paid = models.filter((m) => !m.endsWith(":free"));
      // A paid model costs money per call: the size of one answer must be bounded.
      if (paid.length > 0 && def.config.maxTokens === undefined) {
        problems.push(`agents.${id}: OpenRouterAgent (used by ${usedAt}) uses a paid model (${paid.join(", ")}), so production needs maxTokens to bound the cost of one run`);
      }
      // Free models are rate limited and come and go: one of them alone must not be the only reader.
      if (paid.length === 0 && (!Array.isArray(def.config.fallbackModels) || def.config.fallbackModels.length === 0)) {
        problems.push(`agents.${id}: OpenRouterAgent (used by ${usedAt}) uses only free models, which get rate limited, so production needs at least one fallbackModels entry`);
      }
    }
  }

  // A DisabledAgent is fine as a fallback, but if it is the agent that generates, every job would fail at generate.
  for (const [operation, def] of manifest.operations) {
    for (const [i, step] of def.steps.entries()) {
      const id = step.kind === "generate" ? step.config.agent : undefined;
      if (typeof id === "string" && manifest.agents.get(id)?.adapter === "DisabledAgent") {
        problems.push(`operations.${operation}.steps[${i}] (generate): agent "${id}" is a DisabledAgent, so no job could generate (bind a real agent)`);
      }
    }
  }

  // Only agents a step can actually call matter; a declared-but-unused agent block does not run.
  for (const [id, usedAt] of referencedAgents) {
    const def = manifest.agents.get(id);
    if (def && Object.hasOwn(registry.agents, def.adapter) && isLocalOnly((registry.agents as Record<string, unknown>)[def.adapter])) {
      refused(`agents.${id}`, `${def.adapter} (used by ${usedAt})`);
    }
  }
  return problems;
}
