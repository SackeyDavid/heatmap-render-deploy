import { requestsDir } from "../../domain/data-layout.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { pageFileName } from "../../domain/page-file-name.ts";
import { requestPagesDir } from "../../domain/request-id.ts";

/** File name for a saved copy of a page. The scheme has one owner (domain/page-file-name.ts). */
export const savedPageFileName = pageFileName;

export const MAX_FILE_NAME_CHARS = 200;

export const pagesDir = requestPagesDir;

/** Writes each saved page to <dataDir>/pages/<requestId>/<file name>. Returns the directory. */
export async function writeSavedPages(dataDir: string, requestId: string, pages: { url: string; html: string }[]): Promise<string> {
  const dir = pagesDir(dataDir, requestId);
  await mkdir(dir, { recursive: true });
  for (const p of pages) await writeFile(join(dir, savedPageFileName(p.url)), p.html, "utf8");
  return dir;
}

export async function removeSavedPages(dataDir: string, requestId: string): Promise<void> {
  await rm(pagesDir(dataDir, requestId), { recursive: true, force: true });
}

const ARTIFACT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_ARTIFACT_CHARS = 1_000_000;

/**
 * Keeps an operation's extra request files under <dataDir>/requests/<requestId>/. The operation chose the names, so each is
 * checked here (plain file name, bounded size); an offending artifact is dropped and reported, never written outside the folder.
 */
export async function writeArtifacts(
  dataDir: string,
  requestId: string,
  artifacts: { name: string; text: string }[],
): Promise<{ written: string[]; dropped: string[] }> {
  const written: string[] = [];
  const dropped: string[] = [];
  const good = artifacts.filter((a) => (ARTIFACT_NAME.test(a.name) && a.text.length <= MAX_ARTIFACT_CHARS ? true : (dropped.push(a.name), false)));
  if (good.length === 0) return { written, dropped };
  const dir = join(requestsDir(dataDir), requestId);
  await mkdir(dir, { recursive: true });
  for (const a of good) {
    await writeFile(join(dir, a.name), a.text, "utf8");
    written.push(a.name);
  }
  return { written, dropped };
}
