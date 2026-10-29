import { deriveSlug, EXPECTED_OUTPUTS, PRIMARY_ARTIFACT, VERSION_PLACEHOLDER } from "../shared/script-artifacts.ts";
import { PAGE_CONTROLS_FILE, pageSnapshotFile } from "../../domain/page-layout.ts";
import { z } from "zod";
import { fence, render } from "../../domain/template.ts";
import { PRIVATE_KEY_PREFIX_RE } from "../../domain/secrets.ts";
import { SECRET_LIKE } from "../shared/secret-like.ts";
import { StepFailure } from "../../domain/errors.ts";
import { scriptIsLive, type Job } from "../../domain/types.ts";
import { failureEmailDetail } from "../../domain/safe-question.ts";
import { domainToUnicode } from "node:url";
import { BRANDED_EMAIL_IMAGES, renderBrandedEmail } from "../../domain/branded-email.ts";
import type {
  AgenticOperation,
  GenerateRenderArgs,
  OperationContext,
  OperationResult,
  PipelineHooks,
  RepairRenderArgs,
} from "../../ports/index.ts";
import { modelInterpretationSchema } from "./interpretation/schema.ts";
import { interpretationJsonSchema } from "./interpretation/json-schema.ts";
import { leftOutFromNotes } from "../shared/left-out.ts";
import type { KlaviyoChecks, KlaviyoConfirmer } from "./ports.ts";

export const OPERATION_NAME = "klaviyo.segmentation-script";
export { VERSION_PLACEHOLDER, PRIMARY_ARTIFACT, EXPECTED_OUTPUTS };

export const klaviyoSegmentationInput = z.object({
  siteId: z.string().min(1),
  publicKey: z
    .string()
    .refine((v) => !PRIVATE_KEY_PREFIX_RE.test(v), "That looks like a PRIVATE Klaviyo key (pk_...). Use the 6-character Public API Key.")
    .refine((v) => /^[A-Za-z0-9]{6}$/.test(v), "Klaviyo Public API Key must be exactly 6 letters/digits."),
  pages: z.array(z.string().url()).min(1),
  description: z
    .string()
    .min(10)
    .max(4000)
    .refine((v) => !SECRET_LIKE.test(v), "description contains what looks like a private Klaviyo key (pk_...). Remove it."),
  pinnedEventNames: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_ ]*$/)).default([]),
  selectors: z.array(z.string()).default([]),
  platform: z.enum(["custom", "wordpress", "shopify", "bigcommerce", "woocommerce", "other"]).default("custom"),
  notifyEmail: z.string().email(),
  siteSlug: z.string().regex(/^[a-z0-9]+$/).optional(),
  /** What a model (the in-browser helper) read from the description; re-validated here and against the page, never trusted alone. */
  modelInterpretation: modelInterpretationSchema.optional(),
  /** Set by the request mapper when a reading came with the request but none of it could be used (so "turn the helper on" would be the wrong advice). */
  interpretationUnreadable: z.boolean().optional(),
  /**
   * The merchant's approval of what was understood. Only the approve route and the operator CLI/examples set it: the request mapper
   * never copies it from a request body. It carries the interpretation that was approved (answers to pick-one questions applied).
   */
  approval: z.object({ interpretation: modelInterpretationSchema, by: z.enum(["merchant", "operator"]) }).optional(),
});

export type KlaviyoSegmentationInput = z.infer<typeof klaviyoSegmentationInput>;

export interface KlaviyoSegmentationPrompts {
  generate: string;
  repair: string;
  /** Prompt for the server-side interpreter agent (the confirm step's `interpretPrompt`); absent when the manifest has none. */
  interpret?: string;
}

export class KlaviyoSegmentationOperation implements AgenticOperation<KlaviyoSegmentationInput> {
  readonly templateVars = ["siteId", "siteSlug", "platform"] as const;
  readonly name = OPERATION_NAME;
  readonly inputSchema = klaviyoSegmentationInput;

  constructor(
    private readonly prompts: KlaviyoSegmentationPrompts,
    private readonly klaviyo: KlaviyoChecks,
    private readonly confirmer: KlaviyoConfirmer,
  ) {}

  async execute(input: KlaviyoSegmentationInput, ctx: OperationContext): Promise<OperationResult> {
    const job = await ctx.pipeline.run({
      jobId: ctx.jobId,
      operation: this.name,
      steps: ctx.steps,
      hooks: this.hooks(input),
    });
    return { job };
  }

  private hooks(input: KlaviyoSegmentationInput): PipelineHooks {
    const siteSlug = input.siteSlug ?? deriveSlug(input.pages[0] ?? input.siteId);
    const shared = (args: GenerateRenderArgs): Record<string, string> => ({
      siteId: input.siteId,
      siteSlug,
      platform: input.platform,
      contextVersion: args.contextVersion,
      expectedOutputs: args.expectedOutputs.join(", "),
      versionPlaceholder: VERSION_PLACEHOLDER,
      pinnedEvents: input.pinnedEventNames.length ? input.pinnedEventNames.join(", ") : "(none)",
      pinnedSelectors: input.selectors.length ? input.selectors.join("\n") : "(none)",
      merchantRequest: fence("merchant_request", input.description),
      modelInterpretation: input.modelInterpretation
        ? fence("model_interpretation", JSON.stringify(input.modelInterpretation, null, 2))
        : "(none)",
      pageSnapshots: fence(
        "page_snapshots",
        args.snapshots.map((s, i) => `URL: ${s.url}\nTitle: ${s.title}\nSnapshot file: ${pageSnapshotFile(i)}\nControls: ${PAGE_CONTROLS_FILE}`).join("\n\n"),
      ),
    });
    return {
      vars: { siteId: input.siteId, siteSlug, platform: input.platform },
      qaContext: {
        siteSlug,
        pinnedEvents: input.pinnedEventNames,
        ...(input.modelInterpretation ? { modelInterpretation: input.modelInterpretation } : {}),
      },
      verifyInput: { siteId: input.siteId, publicKey: input.publicKey, siteSlug, pinnedEvents: input.pinnedEventNames },
      pages: input.pages,
      primaryArtifact: PRIMARY_ARTIFACT,
      expectedOutputs: EXPECTED_OUTPUTS,
      versionPlaceholder: VERSION_PLACEHOLDER,
      confirm: async ({ snapshots, agentInterpretation, previous }) =>
        this.confirmer.confirm({
          description: input.description,
          pageUrls: input.pages,
          ...(input.modelInterpretation ? { proposed: input.modelInterpretation } : {}),
          ...(input.interpretationUnreadable ? { proposalUnreadable: true } : {}),
          ...(input.approval ? { approval: input.approval } : {}),
          snapshots,
          ...(agentInterpretation !== undefined ? { agentInterpretation } : {}),
          ...(previous ? { previous } : {}),
          interpretPrompt: () =>
            render(this.prompts.interpret ?? "", {
              merchantRequest: fence("merchant_request", input.description),
              pageSnapshots: fence("page_snapshots", `Controls: ${PAGE_CONTROLS_FILE}\n${input.pages.join("\n")}`),
              interpretationSchema: JSON.stringify(interpretationJsonSchema),
            }),
        }),
      validate: async () => {
        const check = await this.klaviyo.checkPrerequisites({ siteId: input.siteId, publicKey: input.publicKey });
        if (!check.klaviyoJsInstalled) {
          throw new StepFailure(
            "Klaviyo.js was not detected on the site.",
            "Is the Klaviyo.js onsite tag installed with your Public API Key? See the install guide, then resubmit.",
            "klaviyo-js-missing",
          );
        }
        if (!check.integrationConnected) {
          throw new StepFailure(
            "The Heatmap Klaviyo integration is not connected for this site.",
            "Can you connect the Klaviyo integration in Heatmap and resubmit?",
            "integration-not-connected",
          );
        }
      },
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

const ADAPTER_NAME = "Klaviyo";

/** The host of the first page, for "your website" in the email (falls back to the site folder name). */
function websiteOf(input: KlaviyoSegmentationInput): string {
  try {
    return domainToUnicode(new URL(input.pages[0] ?? "").hostname.replace(/^www\./, "")) || input.siteSlug || "your website";
  } catch {
    return input.siteSlug ?? "your website";
  }
}

/** Facts about this one job, so no two emails carry the same hard-coded values. */
function jobDetailLines(input: KlaviyoSegmentationInput, job: Job): string[] {
  const published = job.state.published;
  const profile = job.state.verification?.details.profileUrl;
  return [
    `Website: ${websiteOf(input)}`,
    `Adapter: ${ADAPTER_NAME}`,
    ...(input.pages.length > 0 ? [`Pages: ${input.pages.join(", ")}`] : []),
    ...(published ? [`Version: ${published.version}`, `Script address: ${published.url}`] : []),
    `Ready at: ${new Date(job.updatedAt).toUTCString()}`,
    ...(profile ? [`Test profile: ${profile}`] : []),
  ];
}

export function successEmail(input: KlaviyoSegmentationInput, job: Job, segmentsJson: string, notesText = "") {
  const leftOut = leftOutFromNotes(notesText);
  let events = "";
  let segments = "";
  let eventLines: string[] = [];
  let segmentLines: string[] = [];
  try {
    const s = JSON.parse(segmentsJson) as { events?: { name: string; trigger: string }[]; segments?: { name: string; conditions: string }[] };
    eventLines = (s.events ?? []).map((e) => `${e.name}: ${e.trigger}`);
    segmentLines = (s.segments ?? []).map((g) => `${g.name}: ${g.conditions}`);
    events = eventLines.map((l) => `  - ${l}`).join("\n");
    segments = segmentLines.map((l) => `  - ${l}`).join("\n");
  } catch {
    // body still useful without the lists
  }
  return {
    to: input.notifyEmail,
    subject: `Your ${ADAPTER_NAME} tracking code for ${websiteOf(input)} is live`,
    body: [
      "Your site-specific tracking script is live.",
      "",
      `Version: ${job.state.published?.version ?? "unknown"}`,
      "",
      "Events it records:",
      events || "  (see segments.json)",
      "",
      "Klaviyo segments to build:",
      segments || "  (see segments.json)",
      "",
      ...(leftOut.length > 0 ? ["We left these out (they are not in the script):", ...leftOut.map((l) => `  - ${l}`), ""] : []),
      `Test profile with every event: ${job.state.verification?.details.profileUrl ?? "n/a"}`,
    ].join("\n"),
    images: BRANDED_EMAIL_IMAGES,
    html: renderBrandedEmail({
      preheader: `Your ${ADAPTER_NAME} tracking code for ${websiteOf(input)} is live.`,
      heading: "Your tracking code is ready",
      intro: [`Good news. Your tracking code for ${websiteOf(input)} is live, so ${eventLines.length === 1 ? "this action is" : eventLines.length > 1 ? `these ${eventLines.length} actions are` : "your actions are"} now being recorded.`],
      sections: [
        { title: "Setup details", items: jobDetailLines(input, job) },
        { title: "Actions it records", items: eventLines },
        { title: "Klaviyo segments to build", items: segmentLines },
        { title: "Left out of the script", items: leftOut },
      ],
      footnote: "Reply to this email if anything looks wrong.",
    }),
  };
}

export function failureEmail(input: KlaviyoSegmentationInput, job: Job) {
  const f = job.failure;
  if (scriptIsLive(job)) {
    // The script was published and turned on before this step failed: do not tell the merchant nothing changed.
    return {
      to: input.notifyEmail,
      subject: `Your tracking script for ${websiteOf(input)} is live, but we hit a problem afterwards`,
      body: ["Your tracking script is already live on your site.", "", `What happened afterwards: ${failureEmailDetail(f)}`, "", "Nothing you need to do. Reply to this email if anything looks wrong."].join("\n"),
      images: BRANDED_EMAIL_IMAGES,
      html: renderBrandedEmail({
        preheader: "Your tracking code is live. A later step had a problem.",
        heading: "Your tracking code is live",
        intro: [`Your tracking code is already live on ${websiteOf(input)}.`, `What happened afterwards: ${failureEmailDetail(f)}`, "There is nothing you need to do."],
        footnote: "Reply to this email if anything looks wrong.",
      }),
    };
  }
  return {
    to: input.notifyEmail,
    subject: `We need one more detail for ${websiteOf(input)}`,
    body: [
      "We could not publish a passing script, so nothing was changed on your site.",
      "",
      `What happened: ${failureEmailDetail(f)}`,
      "",
      f?.question ?? "Could you reply with more detail about the behavior you want tracked?",
    ].join("\n"),
    images: BRANDED_EMAIL_IMAGES,
    html: renderBrandedEmail({
      preheader: "We need one more detail before we can finish.",
      heading: "We need one more detail",
      intro: [`We could not publish a passing script, so nothing was changed on ${websiteOf(input)}.`, `What happened: ${failureEmailDetail(f)}`, f?.question ?? "Could you reply with more detail about the behavior you want tracked?"],
      footnote: "Just reply to this email with the detail.",
    }),
  };
}
