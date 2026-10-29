import { ConfigError } from "../../domain/errors.ts";

/** What the operator set through the environment. Undefined means "derive it from the manifest". */
export interface HttpOperationsConfig {
  /** HEATMAP_HTTP_OPERATION: the operation used when a request omits `operation`. */
  defaultOperation?: string;
  /** HEATMAP_HTTP_ALLOWED_OPERATIONS: the operations a request may name. */
  allowedOperations?: string[];
}

/** The operations this service accepts, resolved against what the manifest serves over HTTP. */
export interface ResolvedHttpOperations {
  defaultOperation: string;
  allowedOperations: string[];
}

export function loadHttpOperationsConfig(env: Record<string, string | undefined>): HttpOperationsConfig {
  const defaultOperation = env.HEATMAP_HTTP_OPERATION?.trim() || undefined;
  const allowedRaw = env.HEATMAP_HTTP_ALLOWED_OPERATIONS?.trim();
  const allowedOperations = allowedRaw ? allowedRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  return { defaultOperation, allowedOperations };
}

/**
 * Checks the operator's choices against the operations the manifest serves over HTTP (those with a request mapper),
 * at startup: a name the manifest does not serve is a ConfigError naming the env var, not a failure mid-request.
 * Unset choices default to what the manifest serves (the first one is the default). Env var NAMES only in messages.
 */
export function resolveHttpOperations(cfg: HttpOperationsConfig, served: readonly string[]): ResolvedHttpOperations {
  if (served.length === 0) {
    throw new ConfigError(["the manifest declares no operation that can be served over HTTP (no plugin provides a request mapper for any of its operations)"]);
  }
  const problems: string[] = [];
  const allowed = cfg.allowedOperations ?? [...served];
  if (allowed.length === 0) problems.push("HEATMAP_HTTP_ALLOWED_OPERATIONS must name at least one operation");
  for (const name of allowed) {
    if (!served.includes(name)) problems.push(`HEATMAP_HTTP_ALLOWED_OPERATIONS names "${name}", which this manifest does not serve over HTTP (served: ${served.join(", ")})`);
  }
  const defaultOperation = cfg.defaultOperation ?? allowed[0] ?? served[0]!;
  if (cfg.defaultOperation !== undefined) {
    if (!served.includes(cfg.defaultOperation)) {
      problems.push(`HEATMAP_HTTP_OPERATION names "${cfg.defaultOperation}", which this manifest does not serve over HTTP (served: ${served.join(", ")})`);
    } else if (!allowed.includes(cfg.defaultOperation)) {
      problems.push("HEATMAP_HTTP_OPERATION must be listed in HEATMAP_HTTP_ALLOWED_OPERATIONS");
    }
  }
  if (problems.length > 0) throw new ConfigError(problems);
  return { defaultOperation, allowedOperations: allowed };
}

export function resolveRequestOperation(
  body: Record<string, unknown>,
  ops: ResolvedHttpOperations,
): { ok: true; operation: string } | { ok: false; message: string } {
  const raw = body.operation;
  const operation = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : ops.defaultOperation;
  if (!ops.allowedOperations.includes(operation)) {
    return { ok: false, message: `That partner setup is not available here. Choose one of: ${ops.allowedOperations.join(", ")}.` };
  }
  return { ok: true, operation };
}
