// Ports: the only things the application core and operations know about the outside world.
import type {
  AgentId,
  ArtifactVersion,
  Confirmation,
  Finding,
  Job,
  PageSnapshot,
  QaReport,
  StepSpec,
  VerificationResult,
  WorkDirs,
} from "../domain/types.ts";

// ---------- driving ports ----------

export interface JobHandle {
  jobId: string;
  /** Resolves when the job reaches a terminal state (succeeded or failed). */
  done: Promise<Job>;
}

export interface RunOperation {
  run(request: { operation: string; input: unknown; jobId?: string }): Promise<JobHandle>;
}

export interface Schema<T> {
  /** Throws on invalid input. zod schemas satisfy this structurally. */
  parse(input: unknown): T;
}

export interface OperationContext {
  jobId: string;
  /** Steps declared for this operation in the manifest. */
  steps: StepSpec[];
  pipeline: Pipeline;
  logger: Logger;
}

export interface OperationResult {
  job: Job;
}

export interface AgenticOperation<I> {
  readonly name: string;
  readonly inputSchema: Schema<I>;
  /** Names this operation supplies for `{name}` in the manifest's publish key and pointer (besides `{version}`) and as job facts. Checked at startup. */
  readonly templateVars: readonly string[];
  execute(input: I, ctx: OperationContext): Promise<OperationResult>;
}

// ---------- request mapping (driving side) ----------

/** What the HTTP entrypoint has already checked and knows for certain about a request. */
export interface RequestFacts {
  /** From the verified token only, never from the body. */
  siteId: string;
  prompt: string;
  pageUrls: string[];
  notifyEmail: string;
}

export type MappedRequest =
  | {
      ok: true;
      /** Passed to OperationService.run, which validates it with the operation's own schema. */
      input: unknown;
      /** Extra files to keep with the request (stored under the request's folder, name and size checked by the entrypoint). */
      artifacts?: { name: string; text: string }[];
    }
  | { ok: false; code: string; message: string };

/**
 * One operation's say in how a transport request becomes its input. The operation owns its extra body fields and their
 * checks (plain-language message plus a stable code); the entrypoint stays operation-agnostic. Pure: no I/O.
 */
export interface OperationRequestMapper {
  /** Every `code` map() can return (a test keeps them within the documented API codes). */
  readonly errorCodes: readonly string[];
  map(facts: RequestFacts, body: Record<string, unknown>): MappedRequest;
  /**
   * Optional: an approval for a request that paused as "awaiting-approval". `stored` is the input `map` produced for that request;
   * `body` is the approval as received (never trusted: the operation validates the result). Returns the input to run the job again with.
   * An operation without it cannot be approved over HTTP.
   */
  approve?(stored: Record<string, unknown>, body: Record<string, unknown>): { ok: true; input: unknown } | { ok: false; code: string; message: string };
  /** A published file of this operation that lists the names a merchant can test, and how to read the names from it. */
  readonly testTagsFile: string;
  testTags(fileText: string): string[];
  /**
   * Optional merchant-safe wording for a failed step of this operation (`kind` is validate, inspect, generate, qa, publish,
   * verify or notify). Return undefined to use the framework's general wording. `code` is the failing step's own machine-readable cause, if it gave one; there is no internal text to echo.
   */
  failureMessage?(kind: string, code: string | undefined): string | undefined;
  /**
   * Optional: the parts of the request the published result does NOT cover, as plain sentences for the merchant's success page.
   * `notesText` is the published file named by `leftOutFile` (default notes.md). Return at most a few short, sanitised items;
   * an operation without this method reports nothing.
   */
  leftOut?(notesText: string): string[];
  /** The published file `leftOut` reads. Default: notes.md. */
  readonly leftOutFile?: string;
}

// ---------- pipeline ----------

export interface GenerateRenderArgs {
  snapshots: PageSnapshot[];
  contextVersion: string;
  expectedOutputs: string[];
}

export interface RepairRenderArgs extends GenerateRenderArgs {
  findings: Finding[];
  round: number;
}

export interface Email {
  to: string;
  subject: string;
  body: string;
}

/** What an operation's `confirm` hook returns to the pipeline. */
export type ConfirmOutcome =
  /** The requester approved and the approval checks out: continue, with these files placed in the workspace for the generate step. */
  | { kind: "approved"; files: Record<string, string> }
  /** Understood; wait for the requester. The pipeline pauses the job as "awaiting-approval". */
  | { kind: "needs-confirmation"; confirmation: Confirmation }
  /** There is no reading of the request yet: the pipeline asks the step's `interpreter` agent (if the manifest names one) and calls again. */
  | {
      kind: "needs-interpretation";
      prompt: string;
      /** A reading arrived with the request but none of it could be used (not "no reading"): the helper exists, so the requester is asked to try again, not to turn the helper on. */
      unreadable?: boolean;
    };

export interface ConfirmArgs {
  /** The pages as they are NOW (re-read when this is a resumed job, so a changed page is seen). */
  snapshots: PageSnapshot[];
  /** Raw output of the interpreter agent, when one was asked. */
  agentInterpretation?: unknown;
  /** The confirmation saved when the job paused. */
  previous?: Confirmation;
}

/** What an operation supplies to the generic pipeline runner. Nothing here is operation-specific. */
export interface PipelineHooks {
  /**
   * The `confirm` step: understand the request, check it against the pages, and either wait for approval or accept an approval that
   * came with the input. Throw StepFailure (with a question) to refuse. An operation that omits this cannot use a `confirm` step.
   */
  confirm?(args: ConfirmArgs): Promise<ConfirmOutcome>;
  /** Variables for key/pointer templates in the manifest, e.g. { siteId }. */
  vars: Record<string, string>;
  /** Passed verbatim to every quality gate. */
  qaContext: Record<string, unknown>;
  /** Passed verbatim to the verifier. */
  verifyInput: Record<string, unknown>;
  pages: string[];
  /** The artifact that is hashed, versioned and published first, e.g. "script.js". */
  primaryArtifact: string;
  expectedOutputs: string[];
  /** Placeholder replaced with the content-addressed version at publish. */
  versionPlaceholder: string;
  /** Runs before any step; throw StepFailure to refuse the job with a question for the requester. */
  validate?(): Promise<void>;
  renderGeneratePrompt(args: GenerateRenderArgs): string;
  renderRepairPrompt(args: RepairRenderArgs): string;
  renderSuccessEmail(args: { job: Job; files: Record<string, string> }): Email;
  renderFailureEmail(args: { job: Job }): Email;
}

export interface Pipeline {
  run(args: { jobId: string; operation: string; steps: StepSpec[]; hooks: PipelineHooks }): Promise<Job>;
}

// ---------- driven ports ----------

export interface AgentTask {
  agent: AgentId;
  prompt: string;
  contextDir: string;
  workspaceDir: string;
  outputDir: string;
  expectedOutputs: string[];
  limits: { timeoutMs: number; maxTurns?: number };
  /** Free-form job facts an adapter may use; never required. */
  metadata?: Record<string, string>;
}

export interface AgentRunResult {
  ok: boolean;
  exitStatus: number;
  filesProduced: string[];
  transcript: string;
  costUsd?: number;
  durationMs: number;
  error?: string;
  /**
   * Optional merchant-facing text for a refusal. Only an agent that builds it from fixed templates plus sanitised labels may set
   * it (the deterministic rule-table builder does). The pipeline carries it into the failure's `question`.
   */
  question?: string;
}

export interface AgentRunner {
  run(task: AgentTask): Promise<AgentRunResult>;
}

export interface QaInput {
  files: Record<string, string>;
  context: Record<string, unknown>;
}

export interface QualityGate {
  readonly name: string;
  review(input: QaInput): Promise<QaReport>;
}

export interface Verifier {
  verify(args: {
    jobId: string;
    files: Record<string, string>;
    version: ArtifactVersion;
    input: Record<string, unknown>;
    /**
     * The primary artifact exactly as it was published (version placeholder replaced), read back from storage.
     * null: storage could not return it. undefined: the caller did not read it back (a verifier that needs it must fail closed).
     */
    publishedPrimary?: string | null;
  }): Promise<VerificationResult>;
}

export interface PublishedRef {
  key: string;
  url: string;
  sha256: string;
}

export interface PointerTarget {
  version: string;
  url: string;
  sha256: string;
}

export interface RemoteStorage {
  put(key: string, body: string): Promise<PublishedRef>;
  get(key: string): Promise<string | null>;
  /** Moves the pointer at pointerKey to target, remembering the previous version for rollback. */
  pin(pointerKey: string, target: PointerTarget): Promise<void>;
}

export interface PageInspector {
  snapshot(url: string): Promise<PageSnapshot>;
}

export interface ContextPackSource {
  /** Copies the versioned pack (e.g. "klaviyo-onsite-events@v2") into destDir; returns its version. */
  materialize(packId: string, destDir: string): Promise<{ version: string }>;
  /** Whether this pack exists, so the manifest can be checked at startup instead of failing mid-job. */
  has(packId: string): Promise<boolean>;
}

export interface Workspace {
  create(jobId: string): Promise<WorkDirs>;
  write(dir: string, name: string, content: string): Promise<void>;
  /** Reads the named files; missing files are omitted from the result. */
  read(dir: string, names: string[]): Promise<Record<string, string>>;
}

export interface JobStore {
  save(job: Job): Promise<void>;
  get(id: string): Promise<Job | null>;
}

export interface Notifier {
  send(message: Email): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface IdGen {
  next(prefix: string): string;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
