import { CorruptJobError } from "../domain/errors.ts";
import type { Job } from "../domain/types.ts";
import type { JobStore } from "../ports/index.ts";

/**
 * A request this process has no memory of cannot still be running, so a job left `running` (or accepted but never
 * saved as a job) by a crash or restart is marked failed with step "internal". It is not resumed.
 * Returns the ids changed. The caller supplies the accepted requests (id and when they were accepted).
 */
export async function markInterrupted(jobStore: JobStore, accepted: { id: string; createdAt: string }[], nowIso: string): Promise<string[]> {
  const changed: string[] = [];
  for (const { id, createdAt } of accepted) {
    // An unreadable record is treated as a job that never got saved: replace it with a failed one so startup is never blocked.
    const job = await jobStore.get(id).catch((e: unknown) => {
      if (e instanceof CorruptJobError) return null;
      throw e;
    });
    if (job && job.status !== "running") continue;
    const failure = { step: "internal", reason: "interrupted by a service restart" };
    const next: Job = job
      ? { ...job, status: "failed", failure, updatedAt: nowIso }
      : { id, operation: "unknown", status: "failed", completedSteps: [], state: { snapshots: [], repairRounds: 0 }, failure, createdAt, updatedAt: nowIso };
    await jobStore.save(next);
    changed.push(id);
  }
  return changed;
}
