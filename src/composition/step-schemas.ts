import { z } from "zod";
import type { StepSpec } from "../domain/types.ts";

/**
 * The one declaration of what a manifest step may say: its kind, the config keys it accepts (strict: an
 * unknown key or a wrong type is an error), and which earlier steps it needs. wire.ts validates manifests
 * against this table at startup; the runner's dispatch is tied to the same kinds by a test.
 */
/** Defaults for the optional run limits below are STEP_DEFAULTS (domain/step-defaults.ts): maxTurns 40, timeoutMs 600000, maxRepairLoops 2. */
const name = z.string().min(1);
const positive = z.number().positive();

/** Run limits `qa` inherits from `generate` for its repair calls (set by the manifest loader). */
const inheritedRunConfig = {
  agent: name.optional(),
  fallback: name.optional(),
  maxTurns: positive.optional(),
  timeoutMs: positive.optional(),
};

/**
 * Not declared here on purpose: `validate`. The runner always performs it first (the operation's own prerequisite checks,
 * which can call out to a gateway), then runs these declared steps in order. Breakpoints can target it, the manifest cannot
 * remove or reorder it.
 */
export const STEP_SCHEMAS = {
  inspect: { config: z.strictObject({}), requires: [] as string[] },
  // The confirm step: the operation understands the request (from an interpretation a model produced), shows the requester what it
  // understood and pauses until they approve. `interpreter` (optional) is the agent asked to read the description when the request
  // arrived with no interpretation (for example the Claude agent); it returns an interpretation, never a script.
  confirm: {
    config: z.strictObject({
      interpreter: name.optional(),
      interpretPrompt: name.optional(),
      maxTurns: positive.optional(),
      timeoutMs: positive.optional(),
    }),
    requires: ["inspect"],
  },
  generate: {
    config: z.strictObject({
      agent: name,
      fallback: name.optional(),
      prompt: name,
      repairPrompt: name,
      context: name,
      maxTurns: positive.optional(),
      timeoutMs: positive.optional(),
    }),
    requires: ["inspect"],
  },
  qa: {
    config: z.strictObject({
      gates: z.array(name).min(1),
      maxRepairLoops: z.number().int().min(0).optional(),
      ...inheritedRunConfig,
    }),
    requires: ["generate"],
  },
  publish: {
    config: z.strictObject({ key: name, pointer: name.optional() }),
    requires: ["generate"],
  },
  verify: { config: z.strictObject({ verifier: name }), requires: ["publish"] },
  // failure is required, so the policy is always visible in the manifest: "fail" marks the job failed when the email cannot be sent;
  // "warn" keeps it succeeded and records a warning (right when the script is already live by then).
  notify: { config: z.strictObject({ failure: z.enum(["fail", "warn"]) }), requires: ["generate"] },
};

/** Steps the runner reads once (the first one wins), so a second would be silently ignored: refused at startup. */
const UNIQUE_KINDS = new Set(["inspect", "confirm", "generate", "publish", "verify", "notify"]);

export type StepKind = keyof typeof STEP_SCHEMAS;
export const KNOWN_STEP_KINDS: string[] = Object.keys(STEP_SCHEMAS);

/** Returns startup problems for one operation's step list (unknown kind, bad config, missing earlier step). */
export function validateSteps(operation: string, steps: StepSpec[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, step] of steps.entries()) {
    const where = `operations.${operation}.steps[${i}] (${step.kind})`;
    const entry = (STEP_SCHEMAS as Record<string, (typeof STEP_SCHEMAS)[StepKind]>)[step.kind];
    if (!entry) {
      problems.push(`${where}: unknown step kind (known: ${KNOWN_STEP_KINDS.join(", ")})`);
      continue;
    }
    const parsed = entry.config.safeParse(step.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) problems.push(`${where}: ${issue.path.join(".") || "config"}: ${issue.message}`);
    }
    if (UNIQUE_KINDS.has(step.kind) && seen.has(step.kind)) problems.push(`${where}: a second "${step.kind}" step; each manifest lists it at most once`);
    for (const need of entry.requires) {
      if (!seen.has(need)) problems.push(`${where}: needs an earlier "${need}" step`);
    }
    seen.add(step.kind);
  }
  return problems;
}

/** qa repairs run the same agent under the same limits as generate: copy those keys onto each qa step that did not set its own. */
export function inheritRunConfig(steps: StepSpec[]): StepSpec[] {
  const generate = steps.find((s) => s.kind === "generate");
  if (!generate) return steps;
  for (const s of steps) {
    if (s.kind !== "qa") continue;
    for (const key of ["agent", "fallback", "maxTurns", "timeoutMs"] as const) s.config[key] ??= generate.config[key];
  }
  return steps;
}
