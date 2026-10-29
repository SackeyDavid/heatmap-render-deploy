import { deriveSlug, EXPECTED_OUTPUTS, PRIMARY_ARTIFACT, VERSION_PLACEHOLDER } from "../shared/script-artifacts.ts";
import { leftOutFromNotes } from "../shared/left-out.ts";
import { PAGE_CONTROLS_FILE, pageSnapshotFile } from "../../domain/page-layout.ts";
import { z } from "zod";
import { fence, render } from "../../domain/template.ts";
import { scriptIsLive, type Job } from "../../domain/types.ts";
import { failureEmailDetail } from "../../domain/safe-question.ts";
import type {
  AgenticOperation,
  GenerateRenderArgs,
  OperationContext,
  OperationResult,
  PipelineHooks,
  RepairRenderArgs,
} from "../../ports/index.ts";

export const OPERATION_NAME = "generic.heatmap-events";
export { VERSION_PLACEHOLDER, PRIMARY_ARTIFACT, EXPECTED_OUTPUTS };

export const genericHeatmapEventsInput = z.object({
  siteId: z.string().min(1),
  partnerDestination: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,31}$/, "Partner destination must be 2–32 lowercase letters, numbers, or hyphens."),
  pages: z.array(z.string().url()).min(1),
  description: z.string().min(10),
  pinnedEventNames: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_ ]*$/)).default([]),
  selectors: z.array(z.string()).default([]),
  platform: z.enum(["custom", "wordpress", "shopify", "bigcommerce", "woocommerce", "other"]).default("custom"),
  notifyEmail: z.string().email(),
  siteSlug: z.string().regex(/^[a-z0-9]+$/).optional(),
});

export type GenericHeatmapEventsInput = z.infer<typeof genericHeatmapEventsInput>;

export interface GenericHeatmapEventsPrompts {
  generate: string;
  repair: string;
}

export class GenericHeatmapEventsOperation implements AgenticOperation<GenericHeatmapEventsInput> {
  readonly templateVars = ["siteId", "siteSlug", "platform"] as const;
  readonly name = OPERATION_NAME;
  readonly inputSchema = genericHeatmapEventsInput;

  constructor(private readonly prompts: GenericHeatmapEventsPrompts) {}

  async execute(input: GenericHeatmapEventsInput, ctx: OperationContext): Promise<OperationResult> {
    const job = await ctx.pipeline.run({
      jobId: ctx.jobId,
      operation: this.name,
      steps: ctx.steps,
      hooks: this.hooks(input),
    });
    return { job };
  }

  private hooks(input: GenericHeatmapEventsInput): PipelineHooks {
    const siteSlug = input.siteSlug ?? deriveSlug(input.pages[0] ?? input.siteId);
    const shared = (args: GenerateRenderArgs): Record<string, string> => ({
      siteId: input.siteId,
      siteSlug,
      platform: input.platform,
      partnerDestination: input.partnerDestination,
      contextVersion: args.contextVersion,
      expectedOutputs: args.expectedOutputs.join(", "),
      versionPlaceholder: VERSION_PLACEHOLDER,
      pinnedEvents: input.pinnedEventNames.length ? input.pinnedEventNames.join(", ") : "(none)",
      pinnedSelectors: input.selectors.length ? input.selectors.join("\n") : "(none)",
      merchantRequest: fence("merchant_request", input.description),
      pageSnapshots: fence(
        "page_snapshots",
        args.snapshots.map((s, i) => `URL: ${s.url}\nTitle: ${s.title}\nSnapshot file: ${pageSnapshotFile(i)}\nControls: ${PAGE_CONTROLS_FILE}`).join("\n\n"),
      ),
    });
    return {
      vars: { siteId: input.siteId, siteSlug, platform: input.platform },
      qaContext: {
        siteSlug,
        partnerDestination: input.partnerDestination,
        pinnedEvents: input.pinnedEventNames,
      },
      verifyInput: {
        siteId: input.siteId,
        partnerDestination: input.partnerDestination,
        siteSlug,
        pinnedEvents: input.pinnedEventNames,
      },
      pages: input.pages,
      primaryArtifact: PRIMARY_ARTIFACT,
      expectedOutputs: EXPECTED_OUTPUTS,
      versionPlaceholder: VERSION_PLACEHOLDER,
      renderGeneratePrompt: (args) => render(this.prompts.generate, shared(args)),
      renderRepairPrompt: (args: RepairRenderArgs) =>
        render(this.prompts.repair, {
          ...shared(args),
          round: String(args.round),
          findings: args.findings
            .map((f) => `- [${f.gate}/${f.rule}]${f.line ? ` line ${f.line}` : ""}: ${f.message}`)
            .join("\n"),
        }),
      renderSuccessEmail: ({ job, files }) => successEmail(input, job, files["segments.json"] ?? "{}", files["notes.md"] ?? ""),
      renderFailureEmail: ({ job }) => failureEmail(input, job),
    };
  }
}

export function successEmail(input: GenericHeatmapEventsInput, job: Job, segmentsJson: string, notesText = "") {
  const leftOut = leftOutFromNotes(notesText);
  let events = "";
  try {
    const s = JSON.parse(segmentsJson) as { events?: { name: string; trigger: string }[] };
    events = (s.events ?? []).map((e) => `  - ${e.name}: ${e.trigger}`).join("\n");
  } catch {
    // body still useful without the lists
  }
  return {
    to: input.notifyEmail,
    subject: "Your custom event tracking script is live",
    body: [
      "Your site-specific tracking script is live.",
      "",
      `Partner destination: ${input.partnerDestination}`,
      `Version: ${job.state.published?.version ?? "unknown"}`,
      "",
      "Events it records:",
      events || "  (see segments.json)",
      "",
      ...(leftOut.length > 0 ? ["We left these out (they are not in the script):", ...leftOut.map((l) => `  - ${l}`), ""] : []),
      `Test profile: ${job.state.verification?.details.profileUrl ?? "n/a"}`,
    ].join("\n"),
  };
}

export function failureEmail(input: GenericHeatmapEventsInput, job: Job) {
  const f = job.failure;
  if (scriptIsLive(job)) {
    // The script was published and turned on before this step failed: do not tell the merchant nothing changed.
    return {
      to: input.notifyEmail,
      subject: "Your tracking script is live, but we hit a problem afterwards",
      body: ["Your tracking script is already live on your site.", "", `What happened afterwards: ${failureEmailDetail(f)}`, "", "Nothing you need to do. Reply to this email if anything looks wrong."].join("\n"),
    };
  }
  return {
    to: input.notifyEmail,
    subject: "We need one more detail for your tracking setup",
    body: [
      "We could not publish a passing script, so nothing was changed on your site.",
      "",
      `What happened: ${failureEmailDetail(f)}`,
      "",
      f?.question ?? "Could you reply with more detail about the behavior you want tracked?",
    ].join("\n"),
  };
}
