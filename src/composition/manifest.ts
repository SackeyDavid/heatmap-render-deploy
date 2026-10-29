import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { ConfigError } from "../domain/errors.ts";
import type { StepSpec } from "../domain/types.ts";
import { inheritRunConfig } from "./step-schemas.ts";

const stepSchema = z
  .record(z.string(), z.record(z.string(), z.unknown()).default({}))
  .refine((o) => Object.keys(o).length === 1, "each step must have exactly one key");

/** A binding is an adapter name, or `{ adapter, ...settings }` when the adapter takes settings declared in the manifest. */
const bindingValue = z.union([z.string(), z.object({ adapter: z.string() }).passthrough()]);

/** Strict: an unknown key anywhere in the manifest is a startup error, never silently dropped. Agent blocks pass extra keys through to the adapter factory, and wire.ts rejects the ones the adapter does not read. */
const manifestSchema = z.strictObject({
  agents: z.record(z.string(), z.object({ adapter: z.string() }).passthrough()),
  bindings: z.strictObject({
    remoteStorage: bindingValue,
    workspace: bindingValue,
    pageInspector: bindingValue,
    contextPack: bindingValue,
    jobStore: bindingValue,
    notifier: bindingValue,
  }),
  operations: z.record(
    z.string(),
    z.strictObject({
      adapter: z.string(),
      steps: z.array(stepSchema).min(1),
    }),
  ),
});

export const BINDING_NAMES = ["remoteStorage", "workspace", "pageInspector", "contextPack", "jobStore", "notifier"] as const;
export type BindingName = (typeof BINDING_NAMES)[number];
/** The adapter name chosen for each binding. */
export type Bindings = Record<BindingName, string>;

export interface Manifest {
  agents: Map<string, { adapter: string; config: Record<string, unknown> }>;
  bindings: Bindings;
  /** Settings declared with a binding (only for bindings written as `{ adapter, ...settings }`). */
  bindingConfig: Partial<Record<BindingName, Record<string, unknown>>>;
  operations: Map<string, { adapter: string; steps: StepSpec[] }>;
}

export async function loadManifest(path: string): Promise<Manifest> {
  let raw: unknown;
  try {
    raw = parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new ConfigError([`cannot read manifest ${path}: ${(e as Error).message}`]);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const agents = new Map<string, { adapter: string; config: Record<string, unknown> }>();
  for (const [id, { adapter, ...config }] of Object.entries(parsed.data.agents)) agents.set(id, { adapter, config });
  const operations = new Map<string, { adapter: string; steps: StepSpec[] }>();
  for (const [name, op] of Object.entries(parsed.data.operations)) {
    operations.set(name, { adapter: op.adapter, steps: normalizeSteps(op.steps) });
  }
  const bindings = {} as Bindings;
  const bindingConfig: Manifest["bindingConfig"] = {};
  for (const name of BINDING_NAMES) {
    const v = parsed.data.bindings[name];
    if (typeof v === "string") bindings[name] = v;
    else {
      const { adapter, ...config } = v;
      bindings[name] = adapter;
      if (Object.keys(config).length > 0) bindingConfig[name] = config;
    }
  }
  return { agents, bindings, bindingConfig, operations };
}

/** Flattens `- kind: {config}` entries; qa inherits the generate step's agent, fallback and run limits (see inheritRunConfig). */
function normalizeSteps(raw: Record<string, Record<string, unknown>>[]): StepSpec[] {
  const steps: StepSpec[] = raw.map((entry) => {
    const [kind, config] = Object.entries(entry)[0]!;
    return { kind, config: { ...config } };
  });
  return inheritRunConfig(steps);
}
