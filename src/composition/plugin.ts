import type { AgenticOperation, AgentRunner, OperationRequestMapper, QualityGate, Verifier } from "../ports/index.ts";

export interface Env {
  rootDir: string;
  dataDir: string;
  /** The process environment as given to buildApp (injectable in tests). Only composition reads the real `process.env`. */
  vars?: Record<string, string | undefined>;
}

export interface OperationPrompts {
  generate: string;
  repair: string;
  /** Prompt for the confirm step's interpreter agent, when the manifest names one (`interpretPrompt`). */
  interpret?: string;
}

/**
 * Everything one operation contributes to the framework. The framework never imports a plugin by
 * name: composition discovers plugin files in composition/plugins/, and the manifest decides what runs.
 */
export interface OperationPlugin {
  /** Operation adapters by the name used in the manifest's `adapter:` field. */
  operations: Record<string, (prompts: OperationPrompts) => AgenticOperation<unknown>>;
  /**
   * Agent adapters this operation contributes, by the name a manifest's `agents.<id>.adapter` uses (namespaced, e.g.
   * "klaviyo.rule-table-builder"). A manifest names them like any registry adapter; deleting the plugin removes them.
   */
  agents?: Record<string, (env: Env, config: Record<string, unknown>) => AgentRunner>;
  /** Namespaced QA gates, e.g. "klaviyo.contract-lint". */
  gates: Record<string, QualityGate>;
  /** Namespaced verifiers, e.g. "klaviyo.test-profile". */
  verifiers: Record<string, Verifier>;
  /**
   * Operation adapters, gates and verifiers (names from the maps above) that are fakes or test stand-ins and must never run
   * in production. wire.ts rejects a manifest that references one when the app is built in production mode.
   */
  localOnly?: { operations?: string[]; gates?: string[]; verifiers?: string[] };
  /** Why a name this plugin knows is not registered right now (e.g. a setting is missing). wire.ts adds it to the startup error for a manifest that names it. */
  hints?: Record<string, string>;
  /**
   * Operations this plugin can serve over HTTP, by operation name: how a request body becomes the operation's input and
   * where its test names are published. An operation with no mapper is simply not exposed over HTTP.
   */
  http?: { requestMappers?: Record<string, OperationRequestMapper> };
}

export type CreatePlugin = (env: Env) => OperationPlugin;
