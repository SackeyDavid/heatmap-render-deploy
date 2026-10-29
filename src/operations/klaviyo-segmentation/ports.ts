import type { Confirmation, PageSnapshot, VerificationResult } from "../../domain/types.ts";
import type { ConfirmOutcome } from "../../ports/index.ts";

export interface PrerequisiteCheck {
  klaviyoJsInstalled: boolean;
  integrationConnected: boolean;
}

/** Operation-owned port: everything the Klaviyo operation needs from Klaviyo/Heatmap. */
export interface KlaviyoChecks {
  checkPrerequisites(args: { siteId: string; publicKey: string }): Promise<PrerequisiteCheck>;
  /** Sends each event once against a clearly named test profile, through the Heatmap integration path. */
  sendTestEvents(args: {
    siteId: string;
    publicKey: string;
    jobId: string;
    events: string[];
    scriptVersion: string;
  }): Promise<Pick<VerificationResult, "details"> & { eventsSeen: string[] }>;
}

export interface KlaviyoConfirmArgs {
  /** The merchant's description: used only to check that a model quoted it, never to work out what to track. */
  description: string;
  pageUrls: string[];
  /** The interpretation that arrived with the request (the in-browser helper's reading). */
  proposed?: unknown;
  /** True when a reading came with the request but could not be used at all (as opposed to no reading). */
  proposalUnreadable?: boolean;
  /** The merchant's approval, when this is the run after "awaiting-approval". */
  approval?: { interpretation: unknown; by: "merchant" | "operator" };
  snapshots: PageSnapshot[];
  /** Raw answer of the server-side interpreter agent, when it was asked. */
  agentInterpretation?: unknown;
  previous?: Confirmation;
  /** The prompt for the interpreter agent (rendered by the operation, which owns the prompt files). */
  interpretPrompt: () => string;
}

/**
 * Operation-owned port: checks a model's interpretation against the page, builds the "here is what we understood" summary, and checks
 * an approval. Pure; the implementation is an adapter next to the builder.
 */
export interface KlaviyoConfirmer {
  confirm(args: KlaviyoConfirmArgs): ConfirmOutcome;
}
