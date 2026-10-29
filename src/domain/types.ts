// Pure domain model. No imports, no I/O, no vendor or operation names.

export type AgentId = string;

/** One entry of an operation's pipeline, as declared in the manifest. */
export interface StepSpec {
  kind: string;
  config: Record<string, unknown>;
}

export type Severity = "error" | "warn";

export interface Finding {
  gate: string;
  rule: string;
  severity: Severity;
  message: string;
  line?: number;
}

export interface QaReport {
  passed: boolean;
  findings: Finding[];
}

export interface ControlInfo {
  tag: string;
  id?: string;
  ariaLabel?: string;
  text: string;
  // Optional extensions (additive; the fixture inspector leaves them unset). All text is sanitised and bounded by the adapter.
  /** Class tokens, in order. */
  classes?: string[];
  role?: string;
  /** The `type` attribute (inputs and buttons). */
  type?: string;
  name?: string;
  href?: string;
  /** A bounded set of data-* attributes (name without the "data-" prefix). */
  data?: Record<string, string>;
  /** True when the element sits under aria-hidden="true" (still rendered, hidden from assistive technology). */
  ariaHidden?: boolean;
  /** True when the saved page marks the element hidden (display:none and the like). Set by the builder, never by an inspector: a script may show it later. */
  hiddenAtSave?: boolean;
  /**
   * Text of the nearest preceding heading (h1-h6) in the same container, sanitised, at most 80 characters; unset when there is
   * none. Lets a request name a generic button by its card ("Learn More under Fitness for Everyone"). The saved-HTML inspector
   * sets it (rules in its html-controls.ts); the fixture inspector leaves it unset.
   */
  heading?: string;
  /**
   * Id of the DIRECT parent element (sanitised, at most 128 characters), when it has one. Lets a link whose own markup has no id
   * be selected as `#<ancestorId> > a` (WordPress menus: `<li id="menu-item-3468"><a href=...>`). The saved-HTML inspector sets
   * it; the fixture inspector leaves it unset.
   */
  ancestorId?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  html: string;
  controls: ControlInfo[];
  /** Set (true) when more controls were found than the adapter's cap; `controls` then holds the first ones in document order. */
  controlsTruncated?: boolean;
  /** Number of controls found before the cap was applied. */
  totalControls?: number;
  /** Controls that exist in the saved markup but are hidden (hidden attribute, display:none, visibility:hidden). Never click targets; kept so a request that names one gets a specific answer. */
  hiddenControls?: ControlInfo[];
}

export interface WorkDirs {
  rootDir: string;
  contextDir: string;
  workspaceDir: string;
  outputDir: string;
}

/** An immutable, content-addressed published artifact. */
export interface ArtifactVersion {
  version: string;
  sha256: string;
  key: string;
  url: string;
  contextVersion: string;
}

export interface VerificationResult {
  ok: boolean;
  problems: string[];
  /** One specific question for the requester when verification fails. */
  question?: string;
  /** Operation-defined facts worth reporting (e.g. a link to a test record). */
  details: Record<string, string>;
}

/**
 * "awaiting-approval": the operation understood the request and is waiting for the requester to approve what it understood
 * (the `confirm` step). Nothing is built or published until then.
 */
export type JobStatus = "running" | "awaiting-approval" | "succeeded" | "failed";

export interface JobFailure {
  step: string;
  reason: string;
  question?: string;
  /** Machine-readable cause from the failing step (see StepFailure.code), when it gave one. */
  code?: string;
}

/** What the requester is asked to approve, saved on the job so a later approval can be checked against it. Operation-defined content. */
export interface Confirmation {
  /** What to show the requester (plain data, produced by the operation; the transport re-bounds any text). */
  summary: unknown;
  /** Hash of what the page offered when this was understood; an approval on a changed page is refused. */
  fingerprint: string;
  /** The checked interpretation the summary describes (and that the requester approves, possibly with answers applied). */
  proposed: unknown;
  /** Set once an approval was accepted. */
  approved?: boolean;
}

export interface PipelineState {
  snapshots: PageSnapshot[];
  confirmation?: Confirmation;
  dirs?: WorkDirs;
  contextVersion?: string;
  repairRounds: number;
  qa?: QaReport;
  published?: ArtifactVersion;
  /** Key of the "current" pointer to move once the artifact is verified. */
  pendingPointer?: string;
  verification?: VerificationResult;
  /** Problems that did not fail the job (e.g. the notify email could not be sent after the script was published and verified). */
  warnings?: string[];
}

export interface Job {
  id: string;
  operation: string;
  status: JobStatus;
  /** Step ids ("0:inspect") that finished; a resumed job skips them. */
  completedSteps: string[];
  state: PipelineState;
  failure?: JobFailure;
  createdAt: string;
  updatedAt: string;
}

/** True once a job's script is live for the merchant: it has been published and, when a pointer step exists, the pointer has moved (after verify). */
export function scriptIsLive(job: Job): boolean {
  return job.state.published !== undefined && job.state.pendingPointer === undefined;
}
