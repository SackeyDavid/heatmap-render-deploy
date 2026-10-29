/** Runs the builder end to end on a captured page, the same machinery the CLI uses (no model, no HTTP server). */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { InMemoryNotifier } from "../../../src/adapters/notifier/notifiers.ts";
import { NullLogger } from "../../../src/adapters/system.ts";
import { buildApp } from "../../../src/composition/wire.ts";
import { storageDir } from "../../../src/domain/data-layout.ts";
import { eventNamesIn } from "../../../src/operations/klaviyo-segmentation/adapters/contract-lint/contract-lint.ts";

export interface PreviewBuild {
  ok: boolean;
  jobId: string;
  /** Names the script emits (empty on failure). */
  events: string[];
  version?: string;
  script?: string;
  /** Path of the published script file under <data-dir>/storage. */
  scriptFile?: string;
  notes?: string;
  failure?: { step: string; reason: string; question?: string; code?: string };
}

export interface BuildInput {
  rootDir: string;
  dataDir: string;
  pageUrl: string;
  site: string;
  publicKey: string;
  description: string;
  /**
   * What a MODEL read from the description, and the operator's approval of it (see the confirm step). Without it the build is refused with
   * "we need the helper or our assistant": this tool never reads the description itself.
   */
  modelFields?: { modelInterpretation: unknown; approval: { interpretation: unknown; by: "operator" } };
}

export const MANIFEST = "manifests/http-local-builder.yaml";
export const lastBuildPath = (dataDir: string): string => join(resolve(dataDir), "live-preview", "last-build.json");

export async function runPreviewBuild(i: BuildInput): Promise<PreviewBuild> {
  const rootDir = resolve(i.rootDir);
  const dataDir = resolve(i.dataDir);
  const app = await buildApp({
    rootDir,
    manifestPath: join(rootDir, MANIFEST),
    dataDir,
    mode: "local",
    env: {}, // nothing from the environment: the builder needs no keys and this tool never reads .env files
    overrides: { notifier: new InMemoryNotifier(), logger: new NullLogger() },
  });
  const handle = await app.service.run({
    operation: "klaviyo.segmentation-script",
    input: {
      siteId: i.site,
      publicKey: i.publicKey,
      pages: [i.pageUrl],
      description: i.description,
      pinnedEventNames: [],
      selectors: [],
      platform: "custom",
      notifyEmail: "live-preview@example.com",
      ...(i.modelFields ?? {}),
    },
  });
  const job = await handle.done;
  const pub = job.state.published;
  if (job.status !== "succeeded" || !pub) {
    return { ok: false, jobId: job.id, events: [], failure: job.failure ?? { step: "unknown", reason: "the job did not publish a script" } };
  }
  const script = await app.requests.publishedText(job, "script.js");
  const notes = (await app.requests.publishedText(job, "notes.md")) ?? undefined;
  if (script === null) return { ok: false, jobId: job.id, events: [], failure: { step: "publish", reason: "the published script could not be read back" } };
  const result: PreviewBuild = {
    ok: true,
    jobId: job.id,
    events: [...eventNamesIn(script)],
    version: pub.version,
    script,
    scriptFile: join(storageDir(dataDir), pub.key),
    notes,
  };
  await mkdir(join(dataDir, "live-preview"), { recursive: true });
  await writeFile(lastBuildPath(dataDir), JSON.stringify({ pageUrl: i.pageUrl, version: pub.version, events: result.events, builtAt: new Date().toISOString() }, null, 2), "utf8");
  return result;
}

/** The lines under one `## ` heading of notes.md whose title starts with `title` (empty list when there is none). */
export function notesSection(notes: string | undefined, title: string): string[] {
  if (!notes) return [];
  const lines = notes.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## ") && l.slice(3).toLowerCase().startsWith(title.toLowerCase()));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith("## ")) break;
    if (l.trim().length > 0) out.push(l);
  }
  return out;
}

export async function readLastBuild(dataDir: string): Promise<{ pageUrl: string; version: string; events: string[] }> {
  let raw: string;
  try {
    raw = await readFile(lastBuildPath(dataDir), "utf8");
  } catch {
    throw new Error(`No earlier build found at ${lastBuildPath(dataDir)}. Run npm run live:preview -- --description "..." first (same --data-dir).`);
  }
  const j = JSON.parse(raw) as { pageUrl: string; version: string; events: string[] };
  return j;
}
