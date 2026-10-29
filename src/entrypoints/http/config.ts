import { ConfigError } from "../../domain/errors.ts";
import { loadHttpOperationsConfig, type HttpOperationsConfig } from "./operations.ts";

export type HeatmapMode = "local" | "production";

export interface HttpConfig {
  mode: HeatmapMode;
  tokenSecret: string;
  /** Token issuers accepted in this mode: "heatmap" always; "heatmap-local" only in local mode. */
  acceptedIssuers: string[];
  uiOrigin: string;
  host: string;
  port: number;
  bodyLimitBytes: number;
  rateLimitPerMinute: number;
  maxOpenJobsPerSite: number;
  /** HEATMAP_HTTP_OPERATION when set; otherwise derived from the manifest at startup. */
  operation?: string;
  /** HEATMAP_HTTP_ALLOWED_OPERATIONS when set; otherwise every operation the manifest serves over HTTP. */
  allowedOperations?: string[];
  /** When set, scriptUrl is `<base>/<storage key>` instead of the storage adapter's own URL. */
  scriptUrlBase?: string;
}

export const DEFAULT_UI_ORIGIN = "http://127.0.0.1:5173";
export const MIN_SECRET_CHARS = 32;

const int = (env: Record<string, string | undefined>, name: string, def: number, problems: string[], min = 1): number => {
  const raw = env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    problems.push(`${name} must be an integer >= ${min}`);
    return def;
  }
  return n;
};

/** Reads and validates configuration. Throws ConfigError (env var NAMES only, never values) on any problem. */
export function loadHttpConfig(env: Record<string, string | undefined>): HttpConfig {
  const problems: string[] = [];
  const modeRaw = env.HEATMAP_MODE ?? "local";
  if (modeRaw !== "local" && modeRaw !== "production") problems.push('HEATMAP_MODE must be "local" or "production"');
  const mode: HeatmapMode = modeRaw === "production" ? "production" : "local";

  const secret = env.HEATMAP_TOKEN_SECRET ?? "";
  if (secret.length < MIN_SECRET_CHARS) problems.push(`HEATMAP_TOKEN_SECRET is required and must be at least ${MIN_SECRET_CHARS} characters`);

  let uiOrigin = env.UI_ORIGIN ?? "";
  if (uiOrigin === "") {
    if (mode === "production") problems.push("UI_ORIGIN is required in production mode");
    uiOrigin = DEFAULT_UI_ORIGIN;
  }
  try {
    const u = new URL(uiOrigin);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.origin !== uiOrigin) problems.push("UI_ORIGIN must be a bare origin such as http://127.0.0.1:5173");
  } catch {
    problems.push("UI_ORIGIN must be a valid origin");
  }
  const base = env.HEATMAP_SCRIPT_URL_BASE;
  if (!base && mode === "production") problems.push("HEATMAP_SCRIPT_URL_BASE is required in production: it is the public https address merchants load scripts from (without it the API returns file paths or raw bucket addresses a browser cannot load)");
  if (base && mode === "production" && !base.startsWith("https://")) problems.push("HEATMAP_SCRIPT_URL_BASE must be an https address in production");
  if (base) {
    try {
      const u = new URL(base);
      if (u.protocol !== "https:" && u.protocol !== "http:") problems.push("HEATMAP_SCRIPT_URL_BASE must be an http(s) URL");
    } catch {
      problems.push("HEATMAP_SCRIPT_URL_BASE must be a valid URL");
    }
  }

  const port = int(env, "HEATMAP_HTTP_PORT", 8787, problems, 0);
  const bodyLimitBytes = int(env, "HEATMAP_BODY_LIMIT_BYTES", 8 * 1024 * 1024, problems);
  const rateLimitPerMinute = int(env, "HEATMAP_RATE_LIMIT_PER_MIN", 5, problems);
  const maxOpenJobsPerSite = int(env, "HEATMAP_MAX_OPEN_JOBS", 20, problems);
  const ops = loadHttpOperationsConfig(env);
  if (ops.allowedOperations?.length === 0) problems.push("HEATMAP_HTTP_ALLOWED_OPERATIONS must name at least one operation");
  if (ops.defaultOperation && ops.allowedOperations && !ops.allowedOperations.includes(ops.defaultOperation)) {
    problems.push("HEATMAP_HTTP_OPERATION must be listed in HEATMAP_HTTP_ALLOWED_OPERATIONS");
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    mode,
    tokenSecret: secret,
    acceptedIssuers: mode === "production" ? ["heatmap"] : ["heatmap", "heatmap-local"],
    uiOrigin,
    host: env.HEATMAP_HTTP_HOST || "127.0.0.1",
    port,
    bodyLimitBytes,
    rateLimitPerMinute,
    maxOpenJobsPerSite,
    ...(ops.defaultOperation ? { operation: ops.defaultOperation } : {}),
    ...(ops.allowedOperations ? { allowedOperations: ops.allowedOperations } : {}),
    ...(base ? { scriptUrlBase: base.replace(/\/+$/, "") } : {}),
  };
}

export type { HttpOperationsConfig };
