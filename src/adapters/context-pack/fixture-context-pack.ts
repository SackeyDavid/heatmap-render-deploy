import { cp, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ContextPackSource } from "../../ports/index.ts";

/** Copies a versioned pack folder (e.g. "klaviyo-onsite-events@v2") from a local directory. */
export class FixtureContextPackSource implements ContextPackSource {
  constructor(private readonly rootDir: string) {}

  async has(packId: string): Promise<boolean> {
    if (!/^[A-Za-z0-9._-]+@v[0-9]+$/.test(packId)) return false;
    return stat(join(this.rootDir, packId)).then((s) => s.isDirectory(), () => false);
  }

  async materialize(packId: string, destDir: string): Promise<{ version: string }> {
    if (!/^[A-Za-z0-9._-]+@v[0-9]+$/.test(packId)) throw new Error(`Bad context pack id "${packId}" (expected name@vN)`);
    const src = join(this.rootDir, packId);
    const ok = await stat(src).then((s) => s.isDirectory(), () => false);
    if (!ok) {
      const have = await readdir(this.rootDir).catch(() => []);
      throw new Error(`Context pack "${packId}" not found in ${this.rootDir} (have: ${have.join(", ") || "none"})`);
    }
    await cp(src, destDir, { recursive: true });
    return { version: packId };
  }
}
