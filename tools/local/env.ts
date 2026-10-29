import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoRemovedKnobs } from "../../src/composition/plug-in-env.ts";
import { ConfigError } from "../../src/domain/errors.ts";
import { resolveManifestPath } from "../../src/entrypoints/http/manifest-path.ts";
import { MIN_SECRET_LENGTH } from "./site-registry/token.ts";

export const LOCAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface LocalDevEnv {
  rootDir: string;
  dataDir: string;
  tokenSecret: string;
  httpHost: string;
  httpPort: number;
  scriptsHost: string;
  scriptsPort: number;
  authPort: number;
  uiOrigin: string;
  manifestPath: string;
  scriptsCorsOrigins: string[];
}

export class LocalEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalEnvError";
  }
}

/** Validates env for Track 2 local stack. Never reads or prints secret values. */
export function resolveLocalDevEnv(env: Record<string, string | undefined>): LocalDevEnv {
  if (env.HEATMAP_MODE === "production") {
    throw new LocalEnvError("Refusing: HEATMAP_MODE=production. Use local mode for the dev stack.");
  }
  try {
    assertNoRemovedKnobs(env);
  } catch (e) {
    if (e instanceof ConfigError) throw new LocalEnvError(e.problems.join("\n"));
    throw e;
  }
  const tokenSecret = env.HEATMAP_TOKEN_SECRET ?? "";
  if (tokenSecret.length < MIN_SECRET_LENGTH) {
    throw new LocalEnvError(
      `Set HEATMAP_TOKEN_SECRET to at least ${MIN_SECRET_LENGTH} characters (same value for API, auth, and UI session). See env.local.example.`,
    );
  }
  const dataDir = resolve(env.HEATMAP_DATA_DIR || join(LOCAL_ROOT, ".out"));
  const manifestPath = resolveManifestPath(LOCAL_ROOT, env);
  const httpPort = parsePort(env.HEATMAP_HTTP_PORT, 8787, "HEATMAP_HTTP_PORT");
  const scriptsPort = parsePort(env.HEATMAP_SCRIPTS_PORT, 8788, "HEATMAP_SCRIPTS_PORT");
  const authPort = parsePort(env.LOCAL_AUTH_PORT, 8786, "LOCAL_AUTH_PORT");
  const uiOrigin = env.UI_ORIGIN?.trim() || "http://127.0.0.1:5173";
  const scriptsCorsOrigins = (env.HEATMAP_SCRIPTS_CORS_ORIGINS || `${uiOrigin},http://127.0.0.1:9292,http://localhost:9292`)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    rootDir: LOCAL_ROOT,
    dataDir,
    tokenSecret,
    httpHost: env.HEATMAP_HTTP_HOST || "127.0.0.1",
    httpPort,
    scriptsHost: env.HEATMAP_SCRIPTS_HOST || "127.0.0.1",
    scriptsPort,
    authPort,
    uiOrigin,
    manifestPath,
    scriptsCorsOrigins,
  };
}

function parsePort(raw: string | undefined, def: number, name: string): number {
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new LocalEnvError(`${name} must be a valid port.`);
  return n;
}
