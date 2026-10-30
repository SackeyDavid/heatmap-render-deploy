import { MAX_SAVED_PAGE_BYTES } from "../../../domain/page-limits.ts";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PageSnapshot } from "../../../domain/types.ts";
import type { PageInspector } from "../../../ports/index.ts";
import { pageFileName } from "../../../domain/page-file-name.ts";
import { DEFAULT_MAX_CONTROLS, extractFromHtml, sanitizeText } from "./html-controls.ts";

export interface SavedHtmlOptions {
  /** Directory holding the saved pages, named <host>__<path-slug>.html (the fixture inspector's scheme). */
  root: string;
  /** Track 2 local dev: try these dirs when `root` has no file (repo fixtures only; never live fetch). */
  fallbackRoots?: string[];
  /** Largest saved page read, in bytes (default 3,000,000). Larger pages fail; they are never cut short. */
  maxHtmlBytes?: number;
  /** Controls kept per page (default 500). More set `controlsTruncated`. */
  maxControls?: number;
}

export const DEFAULT_MAX_HTML_BYTES = MAX_SAVED_PAGE_BYTES;

/**
 * Reads REAL saved HTML (no live fetch). Same file-name scheme and snapshot shape as the fixture inspector; the control list
 * is richer and the text in it is sanitised because page text is untrusted. Every failure is a plain-language Error.
 */
/** The saved copy is over the size limit (a typed error, so callers never have to read message text). */
export class SavedPageTooLarge extends Error {}
/** There is no saved copy of the address (a typed error, so a live-fetch wrapper can tell this apart from every other failure). */
export class NoSavedCopy extends Error {}

export class SavedHtmlInspector implements PageInspector {
  private readonly maxBytes: number;
  private readonly maxControls: number;

  constructor(private readonly opts: SavedHtmlOptions) {
    this.maxBytes = opts.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
    this.maxControls = opts.maxControls ?? DEFAULT_MAX_CONTROLS;
  }

  async snapshot(url: string): Promise<PageSnapshot> {
    const shown = sanitizeText(String(url), 200);
    let fileName: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not http");
      fileName = pageFileName(url);
    } catch {
      throw new Error(`"${shown}" is not a web address we can read (it must start with http:// or https://).`);
    }
    if (fileName.includes("/") || fileName.includes("\\") || fileName.startsWith(".")) {
      throw new Error(`"${shown}" is not a web address we can read.`);
    }
    const missing = () => new NoSavedCopy(`We have no saved copy of ${shown} (expected a saved page named ${fileName}).`);
    const roots = [this.opts.root, ...(this.opts.fallbackRoots ?? [])];
    let file: string | undefined;
    let size = 0;
    for (const root of roots) {
      const candidate = join(root, fileName);
      try {
        const s = await stat(candidate);
        if (!s.isFile()) continue;
        if (s.size > this.maxBytes) throw this.tooLarge(shown, s.size);
        file = candidate;
        size = s.size;
        break;
      } catch (e) {
        if (e instanceof SavedPageTooLarge) throw e;
      }
    }
    if (!file) throw missing();

    let buf: Buffer;
    try {
      buf = await readFile(file);
    } catch {
      throw missing();
    }
    if (buf.byteLength > this.maxBytes) throw this.tooLarge(shown, buf.byteLength);
    const html = buf.toString("utf8");

    let extracted;
    try {
      extracted = extractFromHtml(html, { maxControls: this.maxControls });
    } catch (e) {
      throw new Error(`We could not read the saved copy of ${shown}: ${(e as Error).message}`);
    }
    const snap: PageSnapshot = { url, title: extracted.title, html, controls: extracted.controls, totalControls: extracted.totalControls };
    if (extracted.truncated) snap.controlsTruncated = true;
    if (extracted.hiddenControls.length > 0) snap.hiddenControls = extracted.hiddenControls;
    return snap;
  }

  private tooLarge(shown: string, bytes: number): SavedPageTooLarge {
    const mb = (b: number) => (b / 1_000_000).toFixed(1);
    return new SavedPageTooLarge(`The saved copy of ${shown} is too large to read (${mb(bytes)} MB; the limit is ${mb(this.maxBytes)} MB). Save a smaller copy of the page and try again.`);
  }
}
