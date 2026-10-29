#!/usr/bin/env node
/**
 * One process, three loopback services: scripts host + HTTP API + local auth stand-in.
 * Ctrl+C shuts all down. Does not start the UI or Shopify CLI.
 */
import { storageDir } from "../../src/domain/data-layout.ts";
import { join } from "node:path";
import { loadManifest } from "../../src/composition/manifest.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadHttpConfig } from "../../src/entrypoints/http/config.ts";
import { startHttpServer } from "../../src/entrypoints/http/server.ts";
import { buildApp } from "../../src/composition/wire.ts";
import { startScriptsHost } from "./scripts-host/server.ts";
import { configFromEnv, createAuthServer, listenLoopback, HOST as AUTH_HOST } from "./site-registry/server.ts";
import { ConfigError } from "../../src/domain/errors.ts";
import { LocalEnvError, resolveLocalDevEnv } from "./env.ts";


/** Local only: read the git-ignored .env at the repo root (an existing environment variable wins). The service itself never reads .env. */
function loadLocalEnvFile(): void {
  try {
    process.loadEnvFile(join(import.meta.dirname, "..", "..", ".env"));
  } catch {
    /* no .env: the environment alone is used */
  }
}

async function main(): Promise<number> {
  loadLocalEnvFile();
  let local;
  try {
    local = resolveLocalDevEnv(process.env);
  } catch (e) {
    if (e instanceof LocalEnvError || e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }

  // What the generate step runs is whatever the manifest declares (never an env var): report it so nobody is surprised.
  let generateAdapter = "unknown";
  try {
    const manifest = await loadManifest(local.manifestPath);
    for (const op of manifest.operations.values()) {
      const generate = op.steps.find((st) => st.kind === "generate");
      const agentId = typeof generate?.config.agent === "string" ? generate.config.agent : "";
      generateAdapter = manifest.agents.get(agentId)?.adapter ?? generateAdapter;
      break;
    }
  } catch (e) {
    console.error(e instanceof ConfigError ? e.message : e);
    return 2;
  }

  const scripts = await startScriptsHost({
    host: local.scriptsHost,
    port: local.scriptsPort,
    storageRoot: storageDir(local.dataDir),
    corsOrigins: local.scriptsCorsOrigins,
  });

  const app = await buildApp({
    rootDir: local.rootDir,
    dataDir: local.dataDir,
    manifestPath: local.manifestPath,
  });
  const logger = app.logger;

  const httpCfg = loadHttpConfig({
    ...process.env,
    HEATMAP_TOKEN_SECRET: local.tokenSecret,
    HEATMAP_HTTP_HOST: local.httpHost,
    HEATMAP_HTTP_PORT: String(local.httpPort),
    // Hosted test: the scripts are reached through a public address, not the loopback one.
    HEATMAP_SCRIPT_URL_BASE: process.env.HEATMAP_SCRIPT_URL_BASE?.trim() || scripts.url,
    HEATMAP_RATE_LIMIT_PER_MIN: process.env.HEATMAP_RATE_LIMIT_PER_MIN ?? "60",
    UI_ORIGIN: local.uiOrigin,
  });

  const http = await startHttpServer({ app, config: httpCfg, dataDir: local.dataDir, logger });

  const authCfg = configFromEnv({
    ...process.env,
    HEATMAP_TOKEN_SECRET: local.tokenSecret,
    UI_BASE: local.uiOrigin,
    LOCAL_AUTH_PORT: String(local.authPort),
  });
  const authServer = createAuthServer(authCfg);
  const authPort = await listenLoopback(authServer, authCfg.port);
  const authUrl = `http://${AUTH_HOST}:${authPort}`;

  console.log("");
  console.log("Local Track 2 stack (dev only). Ctrl+C to stop.");
  console.log("");
  console.log(`  Scripts host   ${scripts.url}   (published script.js files)`);
  console.log(`  HTTP API       ${http.url}   (manifest: ${local.manifestPath.replace(local.rootDir + "/", "")})`);
  console.log(`  Generate agent ${generateAdapter === "ClaudeCodeRunner" ? "Claude Code CLI (claude -p)" : generateAdapter === "FakeAgent" ? "FakeAgent (offline canned script)" : generateAdapter} (from the manifest)`);
  if (generateAdapter === "ClaudeCodeRunner") {
    const claudeOk = await claudeOnPath();
    if (claudeOk) console.log("  Claude CLI     found on PATH (jobs may incur Claude account usage)");
    else console.log("  Claude CLI     NOT on PATH — install/login `claude` before submitting from the UI");
  } else {
    console.log("  Real agent     off — run npm run local:stack:claude (manifests/http-local-claude.yaml) for the Kenn agent demo");
  }
  console.log(`  Local auth     ${authUrl}   (Heatmap sign-in stand-in)`);
  console.log(`  Data dir       ${local.dataDir}`);
  console.log("");
  console.log("  Notify step: console notifier (success/failure emails print here, not SMTP).");
  console.log("");
  console.log("  Sign in (one-time link appears on the page):");
  console.log(`    ${authUrl}/signin?site=example-site`);
  console.log("");
  console.log("  Merchant UI (separate terminal):");
  console.log(`    cd ui && npm run dev    →  ${local.uiOrigin}`);
  console.log("");
  console.log("  Submit saved HTML without the UI:");
  console.log("    npm run local:post -- --fixture fixtures/pages/example.com__home.html");
  console.log("");
  console.log("  One-shot smoke (ephemeral, no stack needed):  npm run smoke:local");
  console.log("  Smoke this stack (API must stay up):         npm run smoke:stack");
  console.log("");

  await new Promise<void>((resolve) => {
    const stop = async () => {
      logger.info("shutting down local stack");
      await http.close();
      await scripts.close();
      await new Promise<void>((r) => authServer.close(() => r()));
      resolve();
      process.exit(0);
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
  });
  return 0;
}

const execFileAsync = promisify(execFile);

async function claudeOnPath(): Promise<boolean> {
  try {
    await execFileAsync("claude", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

process.exit(await main());
