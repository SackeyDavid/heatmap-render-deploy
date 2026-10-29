import type { VerificationResult } from "../../../domain/types.ts";
import type { Verifier } from "../../../ports/index.ts";
import { lintFilesFor, publishedScriptProblems, type PublishedCheckArgs } from "../../shared/published-script-check.ts";
import { parseSegments } from "../../shared/segments.ts";
import { GenericHeatmapEventsLintGate } from "./contract-lint-gate.ts";
import type { PartnerEventChecks } from "../ports.ts";
import { VERSION_PLACEHOLDER } from "../operation.ts";

export class GenericHeatmapEventsVerifier implements Verifier {
  constructor(
    private readonly partner: PartnerEventChecks,
    private readonly lint = new GenericHeatmapEventsLintGate(),
  ) {}

  async verify(args: {
    jobId: string;
    files: Record<string, string>;
    version: { version: string; sha256?: string };
    input: Record<string, unknown>;
    publishedPrimary?: string | null;
  }): Promise<VerificationResult> {
    const parsed = parseSegments(args.files["segments.json"] ?? "");
    if (!parsed.ok) return { ok: false, problems: parsed.problems, details: {} };
    const events = parsed.value.events.map((e) => e.name);

    const published = await this.checkPublished(args);
    if (published.length > 0) return { ok: false, problems: published, details: {} };

    const siteId = String(args.input.siteId ?? "");
    const partnerDestination = String(args.input.partnerDestination ?? "");

    const sent = await this.partner.sendTestEvents({
      siteId,
      partnerDestination,
      jobId: args.jobId,
      events,
      scriptVersion: args.version.version,
    });
    const missing = events.filter((e) => !sent.eventsSeen.includes(e));
    if (missing.length > 0) {
      return {
        ok: false,
        problems: [`Test profile is missing events: ${missing.join(", ")}`],
        question: `The test events ${missing.join(", ")} did not reach the partner destination "${partnerDestination}". Is the Heatmap integration active for this site?`,
        details: sent.details as Record<string, string>,
      };
    }
    return { ok: true, problems: [], details: sent.details as Record<string, string> };
  }

  private async checkPublished(args: PublishedCheckArgs): Promise<string[]> {
    return publishedScriptProblems(args, VERSION_PLACEHOLDER, ({ text, siteSlug, pinnedEvents }) => {
      const partnerDestination = args.input.partnerDestination;
      if (typeof partnerDestination !== "string" || partnerDestination.length === 0) {
        return Promise.resolve("The verifier was not given the partner destination, so the published script cannot be re-linted (fail closed)");
      }
      return this.lint.reviewPublished({ files: lintFilesFor(text, args.files), context: { siteSlug, pinnedEvents, partnerDestination } });
    });
  }
}
