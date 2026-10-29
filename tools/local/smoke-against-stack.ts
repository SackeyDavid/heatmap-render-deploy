#!/usr/bin/env node
/**
 * Smoke against a running local stack (npm run local:stack) sharing HEATMAP_DATA_DIR.
 * Does not start servers. Loopback only.
 */
import { signToken } from "./site-registry/token.ts";
import { SiteRegistry } from "./site-registry/registry.ts";
import { LocalEnvError, resolveLocalDevEnv } from "./env.ts";
import { DEFAULT_SMOKE_PROMPT, readFixtureHtml, runSmokePipeline } from "./smoke-pipeline.ts";
import { resolve } from "node:path";

async function main(): Promise<number> {
  let local;
  try {
    local = resolveLocalDevEnv(process.env);
  } catch (e) {
    console.error(e instanceof LocalEnvError ? e.message : e);
    return 2;
  }

  const apiBase = process.env.SMOKE_API_BASE ?? `http://${local.httpHost}:${local.httpPort}`;
  const health = await fetch(`${apiBase.replace(/\/+$/, "")}/healthz`).catch(() => null);
  if (!health?.ok) {
    console.error(`API not reachable at ${apiBase}. Start npm run local:stack (or serve + scripts:host) first.`);
    return 1;
  }

  const site = new SiteRegistry(resolve(local.rootDir, process.env.LOCAL_SITES_FILE ?? ".local-data/sites.json")).get("example-site");
  if (!site) {
    console.error("example-site missing from local sites registry.");
    return 1;
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signToken(
    { iss: "heatmap-local", sub: site.userId, siteId: site.siteId, email: site.userEmail, iat: now, exp: now + 3600 },
    local.tokenSecret,
  );

  const html = await readFixtureHtml(local.rootDir, "fixtures/pages/example.com__home.html");
  const scriptsBase = process.env.HEATMAP_SCRIPT_URL_BASE ?? `http://${local.scriptsHost}:${local.scriptsPort}`;
  const result = await runSmokePipeline({
    apiBase,
    token,
    prompt: DEFAULT_SMOKE_PROMPT,
    pageUrl: "https://example.com/",
    publicKey: "AbC123",
    html,
    expectedScriptOrigin: scriptsBase,
  });
  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }
  console.log("SMOKE OK", { requestId: result.requestId, scriptUrl: result.scriptUrl, testTags: result.testTags });
  return 0;
}

process.exit(await main());
