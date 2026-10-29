import { assertSafeStorageKey, pointerDocument } from "../../../domain/storage-key.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { PointerTarget, PublishedRef, RemoteStorage } from "../../../ports/index.ts";

/** RemoteStorage on the local filesystem. Stand-in for the S3 adapter; same semantics. */
export class LocalFsStorage implements RemoteStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertSafeStorageKey(key);
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`Key escapes storage root: ${key}`);
    return p;
  }

  async put(key: string, body: string): Promise<PublishedRef> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    // Write beside, then rename, so a reader (or a crash) never sees a half-written file, including the pointer.
    const temp = `${p}.${process.pid}.tmp`;
    await writeFile(temp, body, "utf8");
    await rename(temp, p);
    return { key, url: pathToFileURL(p).href, sha256: createHash("sha256").update(body).digest("hex") };
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.path(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async pin(pointerKey: string, target: PointerTarget): Promise<void> {
    await this.put(pointerKey, pointerDocument(await this.get(pointerKey), target));
  }
}
