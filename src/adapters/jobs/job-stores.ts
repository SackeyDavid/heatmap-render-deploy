import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CorruptJobError } from "../../domain/errors.ts";
import { assertSafeJobId } from "../../domain/job-id.ts";
import type { Job } from "../../domain/types.ts";
import type { JobStore } from "../../ports/index.ts";

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();

  async save(job: Job): Promise<void> {
    assertSafeJobId(job.id);
    this.jobs.set(job.id, structuredClone(job));
  }

  async get(id: string): Promise<Job | null> {
    assertSafeJobId(id);
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : null;
  }
}

/** One JSON file per job; enough for a crashed CLI run to resume. */
export class FileJobStore implements JobStore {
  constructor(private readonly dir: string) {}

  async save(job: Job): Promise<void> {
    assertSafeJobId(job.id);
    await mkdir(this.dir, { recursive: true });
    // Write beside, then rename: a crash mid-write leaves the old record, never a half-written one.
    const path = join(this.dir, `${job.id}.json`);
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(job, null, 2), "utf8");
    await rename(temp, path);
  }

  async get(id: string): Promise<Job | null> {
    assertSafeJobId(id);
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), "utf8")) as Job;
    } catch (e) {
      if (e instanceof SyntaxError) throw new CorruptJobError(id);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
}
