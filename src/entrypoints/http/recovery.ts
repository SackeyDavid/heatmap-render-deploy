import { requestsDir } from "../../domain/data-layout.ts";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { REQUEST_ID_RE } from "../../domain/request-id.ts";
import type { Logger } from "../../ports/index.ts";

const REQUEST_FILE_RE = new RegExp(`^(${REQUEST_ID_RE.source.slice(1, -1)})\\.json$`);

/**
 * Startup recovery. Reads the ownership records this layer keeps (which requests were accepted), then asks the
 * application to mark any whose job was left unfinished as failed ("internal"). Returns the ids changed.
 */
export async function recoverInterruptedJobs(opts: {
  markInterrupted: (accepted: { id: string; createdAt: string }[], nowIso: string) => Promise<string[]>;
  dataDir: string;
  nowIso: string;
  logger: Logger;
}): Promise<string[]> {
  const dir = requestsDir(opts.dataDir);
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => REQUEST_FILE_RE.test(f));
  const accepted: { id: string; createdAt: string }[] = [];
  for (const f of files) {
    const id = REQUEST_FILE_RE.exec(f)![1]!;
    let createdAt = opts.nowIso;
    try {
      const meta = JSON.parse(await readFile(join(dir, f), "utf8")) as { createdAt?: unknown };
      if (typeof meta.createdAt === "string") createdAt = meta.createdAt;
    } catch {
      continue; // unreadable ownership record: leave it alone (lookups for it already return not found)
    }
    accepted.push({ id, createdAt });
  }
  const changed = await opts.markInterrupted(accepted, opts.nowIso);
  if (changed.length > 0) opts.logger.warn("marked interrupted requests as failed", { count: changed.length });
  return changed;
}
