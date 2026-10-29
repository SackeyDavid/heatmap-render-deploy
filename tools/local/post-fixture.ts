#!/usr/bin/env node
/**
 * POST a saved HTML fixture to a running local API (stack or separate serve + scripts:host).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SiteRegistry } from "./site-registry/registry.ts";
import { signToken } from "./site-registry/token.ts";
import { LocalEnvError, resolveLocalDevEnv } from "./env.ts";
import { DEFAULT_SMOKE_PROMPT, pollRequestSuccess } from "./smoke-pipeline.ts";

const HELP = `Usage: npm run local:post -- [options]

Options:
  --fixture <path>     HTML file (default: fixtures/pages/example.com__home.html)
  --page-url <url>     Page address for the saved copy (required unless fixture is example.com__home.html)
  --site <siteId>      Site from local registry (default: example-site)
  --api <origin>       API base (default: http://127.0.0.1:8787)
  --public-key <key>   Klaviyo public key, 6 alnum (default: AbC123)
  --prompt <text>      Tracking description (default: smoke prompt)
  --wait               Poll until succeeded/failed and print scriptUrl
`;

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = { wait: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (a === "--wait") {
      out.wait = true;
      continue;
    }
    const next = argv[i + 1];
    if (a.startsWith("--") && next && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }

  let local;
  try {
    local = resolveLocalDevEnv(process.env);
  } catch (e) {
    console.error(e instanceof LocalEnvError ? e.message : e);
    return 2;
  }

  const fixtureRel = String(args.fixture ?? "fixtures/pages/example.com__home.html");
  const fixturePath = resolve(local.rootDir, fixtureRel);
  let pageUrl = args["page-url"] ? String(args["page-url"]) : "";
  if (!pageUrl) {
    if (fixtureRel.endsWith("example.com__home.html")) pageUrl = "https://example.com/";
    else {
      console.error("Provide --page-url for this fixture (must match the saved snapshot naming).");
      return 2;
    }
  }

  const siteId = String(args.site ?? "example-site");
  const registryFile = process.env.LOCAL_SITES_FILE ?? ".local-data/sites.json";
  const site = new SiteRegistry(resolve(local.rootDir, registryFile)).get(siteId);
  if (!site) {
    console.error(`Site "${siteId}" is not in ${registryFile}. Add it via POST /api/sites or edit the file.`);
    return 2;
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signToken(
    { iss: "heatmap-local", sub: site.userId, siteId: site.siteId, email: site.userEmail, iat: now, exp: now + 3600 },
    local.tokenSecret,
  );

  const html = await readFile(fixturePath, "utf8");
  const apiBase = String(args.api ?? `http://${local.httpHost}:${local.httpPort}`);
  const body = {
    prompt: String(args.prompt ?? DEFAULT_SMOKE_PROMPT),
    pageUrls: [pageUrl],
    publicKey: String(args["public-key"] ?? "AbC123"),
    savedPages: [{ url: pageUrl, html }],
  };

  const created = await fetch(`${apiBase.replace(/\/+$/, "")}/v1/requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await created.text();
  if (created.status !== 202) {
    console.error("POST failed", created.status, text);
    return 1;
  }
  const { requestId } = JSON.parse(text) as { requestId: string };
  console.log(JSON.stringify({ requestId, status: "queued", apiBase, pageUrl, fixture: fixtureRel }, null, 2));

  if (!args.wait) {
    console.error(`Poll: curl -s -H "Authorization: Bearer <token>" ${apiBase}/v1/requests/${requestId}`);
    return 0;
  }

  const scriptsBase = process.env.HEATMAP_SCRIPT_URL_BASE ?? `http://${local.scriptsHost}:${local.scriptsPort}`;
  const result = await pollRequestSuccess({
    apiBase,
    token,
    requestId,
    expectedScriptOrigin: scriptsBase,
  });
  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }
  console.log("POST OK", result);
  return 0;
}

process.exit(await main());
