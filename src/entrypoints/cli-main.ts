import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createCliBreakpointControl } from "../composition/breakpoints-env.ts";
import { loadManifest } from "../composition/manifest.ts";
import { assertNoRemovedKnobs } from "../composition/plug-in-env.ts";
import { resolveMode } from "../composition/startup.ts";
import { buildApp } from "../composition/wire.ts";
import { ConfigError, InvalidInputError, UnknownOperationError } from "../domain/errors.ts";

const RUN_USAGE = `usage: cli run <operation> --input <file.json> [--job-id <id>] [--data-dir <dir>] [--manifest <file>]
       [--mode local|production] [--breakpoint <steps>] [--breakpoint-mode log|pause]

  cli run klaviyo.segmentation-script --input examples/klaviyo-request.json
  HEATMAP_BREAKPOINT=validate,qa HEATMAP_BREAKPOINT_MODE=pause npm run cli -- run ...`;

export interface CliIo {
  out(s: string): void;
  err(s: string): void;
}

const defaultIo: CliIo = {
  out: (s) => console.log(s),
  err: (s) => console.error(s),
};

/** Testable CLI entry (FS-0 slice: `run` only; ops preview lives in tools/local/front-stage-preview.ts). */
export async function main(
  argv: string[],
  deps?: { rootDir?: string; io?: CliIo },
): Promise<number> {
  const io = deps?.io ?? defaultIo;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      input: { type: "string" },
      "job-id": { type: "string" },
      "data-dir": { type: "string" },
      manifest: { type: "string" },
      mode: { type: "string" },
      breakpoint: { type: "string" },
      "breakpoint-mode": { type: "string" },
    },
  });

  const [command, operation] = positionals;
  if (command !== "run" || !operation || !values.input) {
    io.err(RUN_USAGE);
    return 2;
  }

  const rootDir = deps?.rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  try {
    assertNoRemovedKnobs(process.env);
    const input: unknown = JSON.parse(await readFile(resolve(values.input), "utf8"));
    const bpRaw = values.breakpoint?.trim();
    const bpModeRaw = values["breakpoint-mode"]?.trim().toLowerCase();
    const bpMode = bpModeRaw === "pause" ? ("pause" as const) : ("log" as const);
    const overrides =
      bpRaw !== undefined && bpRaw.length > 0 ? { breakpoints: createCliBreakpointControl(bpRaw, bpMode) } : undefined;
    // Same rule as `serve` and plug-in:check (composition/startup.ts): production adapters in the manifest need the mode said out loud.
    const manifestPath = values.manifest ?? resolve(rootDir, "manifests", "operations.yaml");
    const modeValue = resolveMode(values.mode ?? process.env.HEATMAP_MODE, await loadManifest(manifestPath), { required: false });
    const app = await buildApp({ rootDir, manifestPath: values.manifest, dataDir: values["data-dir"], mode: modeValue, overrides });
    const handle = await app.service.run({ operation, input, jobId: values["job-id"] });
    const job = await handle.done;
    io.out(JSON.stringify({ jobId: job.id, status: job.status, version: job.state.published?.version, failure: job.failure }, null, 2));
    return job.status === "succeeded" ? 0 : 1;
  } catch (e) {
    if (e instanceof ConfigError || e instanceof InvalidInputError || e instanceof UnknownOperationError) {
      io.err(e.message);
      return 2;
    }
    throw e;
  }
}
