import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { assertSafeJobId } from "../../../domain/job-id.ts";
import type { WorkDirs } from "../../../domain/types.ts";
import type { Workspace } from "../../../ports/index.ts";

/** Workspace on the local filesystem: one folder per job. */
export class LocalFsWorkspace implements Workspace {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async create(jobId: string): Promise<WorkDirs> {
    assertSafeJobId(jobId);
    const rootDir = join(this.root, jobId);
    const dirs: WorkDirs = {
      rootDir,
      contextDir: join(rootDir, "context"),
      workspaceDir: join(rootDir, "workspace"),
      outputDir: join(rootDir, "output"),
    };
    await Promise.all([dirs.contextDir, dirs.workspaceDir, dirs.outputDir].map((d) => mkdir(d, { recursive: true })));
    return dirs;
  }

  private inside(dir: string, name: string): string {
    const base = resolve(dir);
    const p = resolve(base, name);
    if (!p.startsWith(base + sep)) throw new Error(`Path escapes directory: ${name}`);
    return p;
  }

  async write(dir: string, name: string, content: string): Promise<void> {
    const p = this.inside(dir, name);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, "utf8");
  }

  async read(dir: string, names: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of names) {
      try {
        out[name] = await readFile(this.inside(dir, name), "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return out;
  }
}
