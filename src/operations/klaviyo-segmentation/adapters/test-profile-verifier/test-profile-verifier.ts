import type { VerificationResult } from "../../../../domain/types.ts";
import type { Verifier } from "../../../../ports/index.ts";
import { VERSION_PLACEHOLDER } from "../../operation.ts";
import type { KlaviyoChecks, PrerequisiteCheck } from "../../ports.ts";
import { parseSegments } from "../../segments.ts";
import { lintFilesFor, publishedScriptProblems, type PublishedCheckArgs } from "../../../shared/published-script-check.ts";
import { ContractLintGate } from "../contract-lint/contract-lint.ts";

/**
 * Verifier. Two parts, and the second is weaker than it sounds:
 *  1. The PUBLISHED, version-stamped script (read back from storage, not the file the agent wrote) must carry its version
 *     stamp exactly once, equal the unstamped file with the placeholder replaced, hash to the recorded sha256, and pass the
 *     contract lint again (allowlist, event parity with segments.json).
 *  2. Every event in segments.json must be visible on a test profile. With the bound KlaviyoChecks that is an IN-MEMORY FAKE
 *     (Deferred D3): it echoes back whatever it was asked to send, so it proves the plumbing, NOT that Klaviyo or the Heatmap
 *     integration received anything.
 */
export class TestProfileVerifier implements Verifier {
  constructor(
    private readonly klaviyo: KlaviyoChecks,
    private readonly lint: ContractLintGate = new ContractLintGate(),
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
    const publicKey = String(args.input.publicKey ?? "");

    const sent = await this.klaviyo.sendTestEvents({
      siteId,
      publicKey,
      jobId: args.jobId,
      events,
      scriptVersion: args.version.version,
    });
    const missing = events.filter((e) => !sent.eventsSeen.includes(e));
    if (missing.length > 0) {
      return {
        ok: false,
        problems: [`Test profile is missing events: ${missing.join(", ")}`],
        question: `The test events ${missing.join(", ")} did not reach Klaviyo. Is the Heatmap Klaviyo integration active for this site?`,
        details: sent.details,
      };
    }
    return { ok: true, problems: [], details: sent.details };
  }

  /** Problems with the published, stamped script; empty when it is the script that was reviewed. */
  private async checkPublished(args: PublishedCheckArgs): Promise<string[]> {
    return publishedScriptProblems(args, VERSION_PLACEHOLDER, ({ text, siteSlug, pinnedEvents }) =>
      this.lint.reviewPublished({ files: lintFilesFor(text, args.files), context: { siteSlug, pinnedEvents } }),
    );
  }
}

/** Fake KlaviyoChecks: records the events it is asked to send and echoes them back as seen. */
export class InMemoryKlaviyoChecks implements KlaviyoChecks {
  readonly sent: { jobId: string; events: string[]; scriptVersion: string }[] = [];

  constructor(
    private readonly opts: { prerequisites?: PrerequisiteCheck; dropEvents?: string[] } = {},
  ) {}

  async checkPrerequisites(): Promise<PrerequisiteCheck> {
    return this.opts.prerequisites ?? { klaviyoJsInstalled: true, integrationConnected: true };
  }

  async sendTestEvents(args: { jobId: string; events: string[]; scriptVersion: string }) {
    this.sent.push({ jobId: args.jobId, events: args.events, scriptVersion: args.scriptVersion });
    const dropped = new Set(this.opts.dropEvents ?? []);
    const profileId = `heatmap-test-${args.jobId}`;
    return {
      eventsSeen: args.events.filter((e) => !dropped.has(e)),
      details: { profileId, profileUrl: `https://www.klaviyo.com/profile/${profileId}` },
    };
  }
}
