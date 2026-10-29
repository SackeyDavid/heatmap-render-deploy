/**
 * Live preview: run the builder's generated script on the REAL manduu.com page, inside one browser session only, so its
 * events go through the real Heatmap snippet. Nothing on the live site is changed (no WordPress edit). One loopback
 * process (127.0.0.1): capture receiver, builder run, script server.
 *
 *   npm run live:preview -- --description "<text>" [--page-url https://manduu.com/] [--site example-site] [--port 28795]
 *       [--data-dir <dir>] [--public-key AbC123] [--from-html <file>] [--timeout 900]
 *   npm run live:preview -- --check <readout.json> [--data-dir <dir>]
 *
 * See docs/status/MANDUU-LIVE-PREVIEW.md.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { pageFileName } from "../../src/domain/page-file-name.ts";
import { notesSection, readLastBuild, runPreviewBuild } from "./live-preview/build.ts";
import { checkReadOut, parseReadOut } from "./live-preview/check.ts";
import { LOOPBACK_HOST, assertLoopbackHost, originOf, startPreviewServer } from "./live-preview/server.ts";
import { CLEAR_MARKERS_SNIPPET, captureSnippet, injectSnippet, readoutSnippet } from "./live-preview/snippets.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const USAGE = `usage: npm run live:preview -- --description "<text>" (--interpretation <file.json> | --mock-interpreter) [--page-url https://manduu.com/] [--site example-site] [--port 28795]
                                  [--data-dir <dir>] [--public-key AbC123] [--from-html <file>] [--timeout <seconds>]
         --interpretation   the JSON a model (the browser helper or the Claude agent) produced for this description
         --mock-interpreter TEST-ONLY stand-in for the model (old phrase rules in test/support/mock-interpreter); not what ships
       npm run live:preview -- --check <readout.json> [--data-dir <dir>]`;

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

const hr = (title: string) => `\n=== ${title} ===`;

export const SAFETY_NOTE = (pageOrigin: string): string =>
  [
    hr("SAFETY AND LIMITS"),
    "- Nothing on the live site is changed. No WordPress edit, no file uploaded to Manduu. The script is loaded only into the browser tab where you run the INJECT snippet; reloading the tab removes it.",
    `- The helper listens on ${LOOPBACK_HOST} only (this computer). Stop it with Ctrl+C when done.`,
    "- Events go to Manduu's real Heatmap and, for an identified visit (opened from a Klaviyo email link), on to Klaviyo as a TEST. Use a test profile.",
    "- Heatmap fires each event name once per visit and remembers it in localStorage (keys starting hCT_). A name already marked earlier is skipped for that browser. To clear ONLY those keys, run in the page console:",
    `    ${CLEAR_MARKERS_SNIPPET}`,
    "  Clearing makes a repeat event appear again in Klaviyo (a second event for the same profile).",
    "- Each LEARN MORE opens a video popup; close it before the next click, or it covers the page.",
    "- The capture is a rendered DOM export (document.documentElement.outerHTML), not the original server HTML. Selectors found on it should still match the live page, but check the read-out.",
    "- The page already runs Kenn's v2 script (Title Case names), so Heatmap may show both spellings of a name. The read-out lists which names the builder script itself logged.",
    "- Do not capture a page while logged in as a customer: the DOM export may contain personal data. The helper never logs the HTML.",
    `- The helper answers cross-origin requests only for ${pageOrigin} (the page origin) and rejects every other origin.`,
  ].join("\n");

/** The interpretation to build from: a model's answer from a file, or (explicitly asked for) the test-only stand-in. Never the description itself. */
async function runPreviewBuildFields(a: { description: string; pageUrl: string; dataDir: string; interpretationFile?: string; mock: boolean; io: Io }) {
  if (a.interpretationFile) {
    const interpretation = JSON.parse(await readFile(resolve(a.interpretationFile), "utf8")) as unknown;
    return { modelInterpretation: interpretation, approval: { interpretation, by: "operator" as const } };
  }
  if (a.mock) {
    a.io.out("NOTE: --mock-interpreter is the TEST-ONLY stand-in for the model (old phrase rules), not what the product ships.");
    const { mockModelFields } = await import("../../test/support/mock-interpreter/index.ts");
    return mockModelFields(a.description, [a.pageUrl], ROOT, join(a.dataDir, "pages"));
  }
  throw new Error("A model has to read the description first. Pass --interpretation <file.json> (the JSON the browser helper or the Claude agent produced) or, for tests only, --mock-interpreter.");
}

export async function main(argv: string[], io: Io = { out: (s) => console.log(s), err: (s) => console.error(s) }): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: argv,
      options: {
        description: { type: "string" },
        "page-url": { type: "string", default: "https://manduu.com/" },
        site: { type: "string", default: "example-site" },
        port: { type: "string", default: "28795" },
        host: { type: "string", default: LOOPBACK_HOST },
        "data-dir": { type: "string" },
        "public-key": { type: "string", default: "AbC123" },
        "from-html": { type: "string" },
        timeout: { type: "string", default: "900" },
        check: { type: "string" },
        interpretation: { type: "string" },
        "mock-interpreter": { type: "boolean", default: false },
      },
    }).values;
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const str = (k: string) => values[k] as string | undefined;
  const dataDir = resolve(str("data-dir") ?? join(ROOT, ".out", "live-preview"));

  if (str("check") !== undefined) return runCheck(str("check")!, dataDir, io);

  const description = str("description")?.trim();
  if (!description) {
    io.err(USAGE);
    return 2;
  }
  const port = Number(str("port"));
  const timeoutSec = Number(str("timeout"));
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !(timeoutSec > 0)) {
    io.err(`--port must be 0-65535 and --timeout a positive number of seconds\n${USAGE}`);
    return 2;
  }
  const pageUrl = str("page-url")!;
  try {
    assertLoopbackHost(str("host")!);
    originOf(pageUrl);
  } catch (e) {
    io.err((e as Error).message);
    return 2;
  }
  const site = str("site")!;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(site)) {
    io.err("--site may contain only letters, digits, dot, dash and underscore");
    return 2;
  }

  const server = await startPreviewServer({ port, pageUrl, dataDir });
  try {
    io.out(`live preview helper on ${server.url} (loopback only). Page: ${pageUrl}`);
    let capturedUrl = pageUrl;
    const fromHtml = str("from-html");
    if (fromHtml !== undefined) {
      await mkdir(server.pagesDir, { recursive: true });
      await copyFile(resolve(fromHtml), join(server.pagesDir, pageFileName(pageUrl)));
      io.out(`Using ${fromHtml} as the captured page (no browser capture).`);
    } else {
      io.out(hr("STEP 1: CAPTURE (run in DevTools on the real page, tab " + pageUrl + ")"));
      io.out(captureSnippet(server.url));
      io.out(`\nWaiting up to ${timeoutSec} seconds for the capture...`);
      const cap = await server.waitForCapture(timeoutSec * 1000);
      capturedUrl = cap.url;
      io.out(`Captured ${cap.url} (${cap.bytes} bytes) as pages/${cap.file}`);
    }

    io.out(hr("BUILD"));
    let modelFields: Awaited<ReturnType<typeof runPreviewBuildFields>> | undefined;
    try {
      modelFields = await runPreviewBuildFields({ description, pageUrl: capturedUrl, dataDir, interpretationFile: str("interpretation"), mock: values["mock-interpreter"] === true, io });
    } catch (e) {
      io.err((e as Error).message);
      return 2;
    }
    const build = await runPreviewBuild({ rootDir: ROOT, dataDir, pageUrl: capturedUrl, site, publicKey: str("public-key")!, description, ...(modelFields ? { modelFields } : {}) });
    if (!build.ok || !build.script || !build.version) {
      const f = build.failure;
      io.err(`Build did not publish a script (step ${f?.step}). Nothing was changed anywhere.\nReason: ${f?.reason}${f?.question ? `\nQuestion: ${f.question}` : ""}`);
      return 1;
    }
    io.out(`Events built (${build.events.length}):`);
    for (const e of build.events) io.out(`  - ${e}`);
    for (const [title, label] of [["Clicks", "Selectors chosen"], ["Scroll depth", "Scroll depth"], ["Not tracked", "NOT TRACKED / left out (these are NOT in the script)"]] as const) {
      const lines = notesSection(build.notes, title);
      if (lines.length > 0) io.out(`\n${label}:\n${lines.map((l) => "  " + l).join("\n")}`);
    }
    if (notesSection(build.notes, "Not tracked").length === 0) io.out("\nNot tracked: nothing left out.");
    io.out(`\nPublished version: ${build.version}`);
    io.out(`Published file:    ${build.scriptFile}`);
    io.out("Steps passed: contract lint, publish, verify (verify is the local stand-in test profile, not Klaviyo).");

    server.setScript(build.script);
    io.out(hr("STEP 2: INJECT (run in DevTools on the real page; loads the script into THIS tab only)"));
    io.out(injectSnippet(`${server.url}/script.js`, build.version));
    io.out(hr("STEP 3: CLICK AND SCROLL, then READ OUT (run in the same tab; prints JSON; save it to a file)"));
    io.out(readoutSnippet());
    io.out(`\nThen compare:  npm run live:preview -- --check <readout.json>${str("data-dir") ? ` --data-dir ${str("data-dir")}` : ""}`);
    io.out(SAFETY_NOTE(originOf(pageUrl)));
    io.out(`\nServing ${server.url}/script.js. Press Ctrl+C to stop.`);
    await new Promise<void>((done) => {
      process.once("SIGINT", () => done());
      process.once("SIGTERM", () => done());
    });
    return 0;
  } catch (e) {
    io.err((e as Error).message);
    return 1;
  } finally {
    await server.close();
  }
}

async function runCheck(file: string, dataDir: string, io: Io): Promise<number> {
  try {
    const readout = parseReadOut(JSON.parse(await readFile(resolve(file), "utf8")));
    const last = await readLastBuild(dataDir);
    const res = checkReadOut(last.events, readout);
    io.out(`Checking read-out against build ${last.version} (${last.events.length} events, page ${last.pageUrl})`);
    for (const l of res.lines) io.out(l);
    return res.pass ? 0 : 1;
  } catch (e) {
    io.err(`--check failed: ${(e as Error).message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
