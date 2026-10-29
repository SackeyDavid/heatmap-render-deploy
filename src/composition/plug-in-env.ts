import type { SmtpConfig } from "../adapters/notifier/smtp-notifier.ts";
import type { S3StorageConfig } from "../adapters/storage/s3/s3-remote-storage.ts";
import { ConfigError } from "../domain/errors.ts";

export interface PlugInMatrixRow {
  env: string;
  adapter: string;
  requiredWhen: string;
  verifyCommand: string;
}

/** What plugs in where (names only; no secret values). Adapters are chosen in the manifest, never by an env var. */
export const PLUG_IN_MATRIX: PlugInMatrixRow[] = [
  {
    env: "HEATMAP_MANIFEST (agents: block)",
    adapter: "FakeAgent | ClaudeCodeRunner | OpenRouterAgent | DisabledAgent",
    requiredWhen: "ClaudeCodeRunner needs Claude CLI on PATH + account credit: manifests/http-local-claude.yaml. OpenRouterAgent needs OPENROUTER_API_KEY (free models by default): manifests/http-local-openrouter.yaml",
    verifyCommand: "npm run local:stack:claude (see docs/status/STREAM-REAL-AGENT.md)",
  },
  {
    env: "HEATMAP_MANIFEST (bindings.remoteStorage)",
    adapter: "local-fs | s3 → S3RemoteStorage",
    requiredWhen: "s3: AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY",
    verifyCommand: "HEATMAP_MANIFEST=manifests/http-production.example.yaml npm run plug-in:check, then npm run serve",
  },
  {
    env: "HEATMAP_MANIFEST (bindings.notifier)",
    adapter: "console (default) | smtp → SmtpNotifier",
    requiredWhen: "smtp: SMTP_HOST, SMTP_FROM (+ SMTP_USER/SMTP_PASS if AUTH required)",
    verifyCommand: "Submit job with notifyEmail; check inbox or SMTP logs",
  },
  {
    env: "HEATMAP_MANIFEST (operation adapter + verify step)",
    adapter: "KlaviyoSegmentationOperation + klaviyo.test-profile (in-memory, local only) | KlaviyoSegmentationOperationLive + klaviyo.gateway-profile (HeatmapGatewayKlaviyoChecks)",
    requiredWhen: "gateway: HEATMAP_KLAVIYO_GATEWAY_URL; optional HEATMAP_KLAVIYO_GATEWAY_KEY",
    verifyCommand: "Verify step on a succeeded job hits the gateway /v1/klaviyo/test-events",
  },
  {
    env: "HEATMAP_SCRIPT_URL_BASE",
    adapter: "CDN / scripts host origin for scriptUrl in API responses",
    requiredWhen: "Any browser-loadable script URL (production + local stack)",
    verifyCommand: "npm run local:stack sets http://127.0.0.1:8788; curl scriptUrl returns JS",
  },
  {
    env: "HEATMAP_HTTP_OPERATION",
    adapter: "Default POST /v1/requests operation (must be an operation the manifest serves over HTTP)",
    requiredWhen: "Optional; defaults to the first HTTP-served operation in the manifest",
    verifyCommand: "HEATMAP_HTTP_OPERATION=generic.heatmap-events npm run serve — UI may also send body.operation",
  },
  {
    env: "HEATMAP_HTTP_ALLOWED_OPERATIONS",
    adapter: "Comma-separated allowlist for body.operation",
    requiredWhen: "Optional; defaults to every operation the manifest serves over HTTP; a name the manifest does not serve fails at startup",
    verifyCommand: "Restrict prod to one partner: HEATMAP_HTTP_ALLOWED_OPERATIONS=klaviyo.segmentation-script",
  },
  {
    env: "HEATMAP_RATE_LIMIT_PER_MIN",
    adapter: "HTTP per-site request limit",
    requiredWhen: "Optional; default 5 requests per minute per site",
    verifyCommand: "A 6th request inside a minute from one site answers 429 rate-limited",
  },
  {
    env: "HEATMAP_MAX_OPEN_JOBS",
    adapter: "HTTP per-site cap on unfinished requests",
    requiredWhen: "Optional; default 20 open requests per site",
    verifyCommand: "Requests above the cap answer 429 too-many-open",
  },
  {
    env: "HEATMAP_BODY_LIMIT_BYTES",
    adapter: "HTTP request body size limit",
    requiredWhen: "Optional; default 8388608 (8 MiB)",
    verifyCommand: "A larger body answers 413 too-large",
  },
  {
    env: "bindings.pageInspector: { adapter: saved-html, maxHtmlBytes, maxControls }",
    adapter: "Saved-page limits (manifest settings, not env)",
    requiredWhen: "Optional; defaults 3000000 bytes per page and 500 controls per page (domain/page-limits.ts and adapters/inspector/saved-html/html-controls.ts)",
    verifyCommand: "A page above the byte limit is refused with a plain message",
  },
  {
    env: "HEATMAP_TOKEN_SECRET",
    adapter: "HS256 JWT for API + UI embed",
    requiredWhen: "Always (HTTP serve / local stack)",
    verifyCommand: "GET /healthz; sign-in link from local auth includes ?token=",
  },
];

function req(env: Record<string, string | undefined>, name: string, problems: string[]): string {
  const v = env[name]?.trim();
  if (!v) problems.push(`${name} is required when this plug-in is active`);
  return v ?? "";
}

export function loadS3Config(env: Record<string, string | undefined>): S3StorageConfig {
  const problems: string[] = [];
  const region = req(env, "AWS_REGION", problems);
  const bucket = req(env, "AWS_S3_BUCKET", problems);
  const accessKeyId = req(env, "AWS_ACCESS_KEY_ID", problems);
  const secretAccessKey = req(env, "AWS_SECRET_ACCESS_KEY", problems);
  if (problems.length) throw new ConfigError(problems);
  const publicBaseUrl = env.AWS_S3_PUBLIC_BASE_URL?.trim() || env.HEATMAP_SCRIPT_URL_BASE?.trim();
  const endpoint = env.AWS_S3_ENDPOINT?.trim();
  return {
    region,
    bucket,
    credentials: { accessKeyId, secretAccessKey, ...(env.AWS_SESSION_TOKEN?.trim() ? { sessionToken: env.AWS_SESSION_TOKEN.trim() } : {}) },
    ...(publicBaseUrl ? { publicBaseUrl: publicBaseUrl.replace(/\/+$/, "") } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}

export function loadSmtpConfig(env: Record<string, string | undefined>): SmtpConfig {
  const problems: string[] = [];
  const host = req(env, "SMTP_HOST", problems);
  const from = req(env, "SMTP_FROM", problems);
  const portRaw = env.SMTP_PORT?.trim();
  let port = 587;
  if (portRaw) {
    port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT must be a valid port");
  }
  if (problems.length) throw new ConfigError(problems);
  return {
    host,
    port,
    from,
    ...(env.SMTP_USER?.trim() ? { user: env.SMTP_USER.trim() } : {}),
    ...(env.SMTP_PASS?.trim() ? { pass: env.SMTP_PASS.trim() } : {}),
    ...(env.SMTP_STARTTLS === "0" ? { startTls: false } : {}),
  };
}

/** Env knobs that used to pick an adapter outside the manifest. Setting one is an error naming the manifest alternative. */
const REMOVED_KNOBS: Record<string, string> = {
  HEATMAP_AGENT: "choose the agent in the manifest (HEATMAP_MANIFEST=manifests/http-local-claude.yaml, or npm run serve:claude / local:stack:claude)",
  HEATMAP_STORAGE: "set bindings.remoteStorage in the manifest (local-fs or s3; see manifests/http-production.example.yaml)",
  HEATMAP_NOTIFIER: "set bindings.notifier in the manifest (console, in-memory or smtp; see manifests/http-production.example.yaml)",
  HEATMAP_KLAVIYO_VERIFIER: "choose the operation adapter and verifier in the manifest (KlaviyoSegmentationOperationLive + klaviyo.gateway-profile with HEATMAP_KLAVIYO_GATEWAY_URL set; see manifests/http-production.example.yaml)",
};

/** Fails closed instead of silently ignoring a knob that no longer selects anything. Env var NAMES only in the message. */
export function assertNoRemovedKnobs(env: Record<string, string | undefined>): void {
  const problems = Object.entries(REMOVED_KNOBS)
    .filter(([name]) => (env[name] ?? "").trim() !== "")
    .map(([name, instead]) => `${name} no longer selects an adapter: ${instead}`);
  if (problems.length) throw new ConfigError(problems);
}
