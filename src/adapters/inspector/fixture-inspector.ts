import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pageFileName } from "../../domain/page-file-name.ts";
import type { ControlInfo, PageSnapshot } from "../../domain/types.ts";
import type { PageInspector } from "../../ports/index.ts";

/** Serves recorded snapshots from <dir>/<host>__<path-slug>.html. Stand-in for headless Chromium. */
export class FixturePageInspector implements PageInspector {
  constructor(private readonly dir: string) {}

  /** Kept for callers that already use it; the scheme itself lives in domain/page-file-name.ts. */
  static fileNameFor(url: string): string {
    return pageFileName(url);
  }

  async snapshot(url: string): Promise<PageSnapshot> {
    const file = join(this.dir, FixturePageInspector.fileNameFor(url));
    let html: string;
    try {
      html = await readFile(file, "utf8");
    } catch {
      throw new Error(`no recorded snapshot for ${url} (expected ${FixturePageInspector.fileNameFor(url)})`);
    }
    return { url, title: /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "", html, controls: extractControls(html) };
  }
}

function extractControls(html: string): ControlInfo[] {
  const controls: ControlInfo[] = [];
  const re = /<(button|a|summary|input|select)\b([^>]*)>([\s\S]*?)(?=<\/\1>|<(?:button|a|summary)\b|$)/gi;
  for (const m of html.matchAll(re)) {
    const attrs = m[2] ?? "";
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
    controls.push({
      tag: m[1]!.toLowerCase(),
      id: attr("id"),
      ariaLabel: attr("aria-label"),
      text: (m[3] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80),
    });
  }
  return controls;
}
