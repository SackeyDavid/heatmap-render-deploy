import { createHash } from "node:crypto";
import type { QaReport } from "../../domain/types.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export interface PublishedCheckArgs {
  files: Record<string, string>;
  version: { version: string; sha256?: string };
  input: Record<string, unknown>;
  publishedPrimary?: string | null;
}

/**
 * The fail-closed check of what was actually PUBLISHED (read back from storage), shared by every operation's verifier so
 * the rule cannot drift between them: it must be readable, carry the version stamp exactly once with the placeholder gone,
 * hash to the recorded sha256, equal the reviewed script with only the stamp added, and pass the contract lint again.
 * `relint` is the operation's own lint call: it returns the lint report, or a string when it cannot lint (fail closed).
 * Returns the problems found; empty means the published script is the one that was reviewed.
 */
export async function publishedScriptProblems(
  args: PublishedCheckArgs,
  placeholder: string,
  relint: (published: { text: string; siteSlug: string; pinnedEvents: string[] }) => Promise<QaReport | string>,
): Promise<string[]> {
  const text = args.publishedPrimary;
  if (typeof text !== "string") return ["The published script could not be read back from storage, so the stamped file was not checked (fail closed)"];
  const problems: string[] = [];
  const version = args.version.version;
  if (text.includes(placeholder)) problems.push(`The published script still contains ${placeholder}; the version stamp was not applied`);
  const stamps = version ? text.split(`"${version}"`).length - 1 : 0;
  if (stamps !== 1) problems.push(`The published script must carry the version "${version}" as a quoted string exactly once, found ${stamps}`);
  if (args.version.sha256 && sha256(text) !== args.version.sha256) problems.push("The published script does not hash to the recorded sha256; storage returned different bytes than were published");
  const source = args.files["script.js"];
  if (source !== undefined && source.split(placeholder).join(version) !== text) problems.push("The published script differs from the reviewed script.js with only the version stamped in");
  const siteSlug = args.input.siteSlug;
  if (typeof siteSlug !== "string" || siteSlug.length === 0) {
    problems.push("The verifier was not given the site slug, so the published script cannot be re-linted (fail closed)");
    return problems;
  }
  const pinnedEvents = Array.isArray(args.input.pinnedEvents) ? args.input.pinnedEvents.map(String) : [];
  const report = await relint({ text, siteSlug, pinnedEvents });
  if (typeof report === "string") {
    problems.push(report);
    return problems;
  }
  for (const f of report.findings) if (f.severity === "error") problems.push(`Published script re-lint [${f.rule}]${f.line ? ` line ${f.line}` : ""}: ${f.message}`);
  return problems;
}

/** The files the published-script lint is given: the published script plus the reviewed segments and notes. */
export const lintFilesFor = (text: string, files: Record<string, string>): Record<string, string> => ({
  "script.js": text,
  "segments.json": files["segments.json"] ?? "",
  "notes.md": files["notes.md"] ?? "published-check",
});
