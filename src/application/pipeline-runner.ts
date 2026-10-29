import { createHash } from "node:crypto";
import { AGENT_QUESTION_CODE, AwaitingApproval, READER_UNAVAILABLE_CODE, StepFailure } from "../domain/errors.ts";
import { boundReason, sanitizeQuestion } from "../domain/safe-question.ts";
import { PAGE_CONTROLS_FILE, pageSnapshotFile } from "../domain/page-layout.ts";
import { stepId as makeStepId } from "../domain/step-id.ts";
import { siblingKey } from "../domain/published-key.ts";
import { STEP_DEFAULTS } from "../domain/step-defaults.ts";
import type { Finding, Job, PipelineState, QaReport, StepSpec } from "../domain/types.ts";
import type {
  AgentRunner,
  AgentRunResult,
  AgentTask,
  Clock,
  ContextPackSource,
  IdGen,
  JobStore,
  Logger,
  Notifier,
  PageInspector,
  Pipeline,
  PipelineHooks,
  QualityGate,
  RemoteStorage,
  Verifier,
  Workspace,
} from "../ports/index.ts";
import type { PipelineBreakpointControl } from "./pipeline-breakpoints.ts";

export interface PipelineDeps {
  agents: Map<string, AgentRunner>;
  gates: Map<string, QualityGate>;
  verifiers: Map<string, Verifier>;
  storage: RemoteStorage;
  inspector: PageInspector;
  contextPack: ContextPackSource;
  workspace: Workspace;
  jobStore: JobStore;
  notifier: Notifier;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
  /** Step-boundary hooks for local QA (`HEATMAP_BREAKPOINT`, CLI `--breakpoint`). */
  breakpoints?: PipelineBreakpointControl;
}


const num = (config: Record<string, unknown>, key: string): number | undefined => {
  const v = config[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
};

const str = (config: Record<string, unknown>, key: string): string | undefined => {
  const v = config[key];
  return typeof v === "string" ? v : undefined;
};

/** Shown when nothing (neither the in-browser helper nor a server assistant) read the description. */
export const NEEDS_READER_QUESTION =
  "We need the helper in your browser, or our assistant, to read your description before we can build anything. Turn on the helper (it is a one-time download) and send your request again.";

/** Shown when a server-side reader is configured but failed (down, rate-limited, timed out) and nothing else read the words. */
export const READER_FAILED_QUESTION = "Our assistant could not read your description just now. Please try again in a few minutes.";

/** Shown when a reading arrived with the request but none of it could be used. */
export const UNREADABLE_ANSWER_QUESTION = "We could not read that answer. Please try again.";

/** Shown (HTTP and email) when the built script fails the automatic checks. Never names a rule or repeats lint text. */
export const QA_FAILED_QUESTION =
  "We built a script, but it didn't pass our automatic checks, so we didn't turn it on. Try describing what you want to track in simpler terms.";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new StepFailure(`the key template names {${name}}, which this operation does not supply`);
    return v;
  });

/** Runs a manifest-declared list of generic steps as a checkpointed job. Knows ports only. */
export class PipelineRunner implements Pipeline {
  constructor(private readonly deps: PipelineDeps) {}

  async run(args: { jobId: string; operation: string; steps: StepSpec[]; hooks: PipelineHooks }): Promise<Job> {
    const { deps } = this;
    const now = () => deps.clock.now().toISOString();
    let job = await deps.jobStore.get(args.jobId);
    if (!job) {
      job = {
        id: args.jobId,
        operation: args.operation,
        status: "running",
        completedSteps: [],
        state: { snapshots: [], repairRounds: 0 },
        createdAt: now(),
        updatedAt: now(),
      };
    } else {
      job = { ...job, status: "running", failure: undefined };
    }
    await deps.jobStore.save(job);

    const checkpoint = async (stepId: string) => {
      job = { ...job!, completedSteps: [...job!.completedSteps, stepId], updatedAt: now() };
      await deps.jobStore.save(job);
    };

    const atBreakpoint = async (stepId: string, phase: "before" | "after") => {
      const bp = deps.breakpoints;
      if (!bp?.shouldBreak(stepId)) return;
      await bp.onStep({ jobId: job!.id, operation: args.operation, stepId, phase });
    };

    const hasVerify = args.steps.some((s) => s.kind === "verify");
    let currentStep = "validate";
    try {
      if (!job.completedSteps.includes("validate")) {
        await atBreakpoint("validate", "before");
        await args.hooks.validate?.();
        await checkpoint("validate");
        await atBreakpoint("validate", "after");
      }
      for (const [index, step] of args.steps.entries()) {
        const stepId = makeStepId(index, step.kind);
        currentStep = stepId;
        if (job.completedSteps.includes(stepId)) {
          deps.logger.info("step skipped (already completed)", { jobId: job.id, step: stepId });
          continue;
        }
        deps.logger.info("step started", { jobId: job.id, step: stepId });
        await atBreakpoint(stepId, "before");
        const state: PipelineState = job.state;
        await this.runStep(step, state, job, args.hooks, hasVerify);
        job = { ...job, state, updatedAt: now() };
        await checkpoint(stepId);
        await atBreakpoint(stepId, "after");
      }
      job = { ...job, status: "succeeded", updatedAt: now() };
      await deps.jobStore.save(job);
    } catch (e) {
      if (e instanceof AwaitingApproval) {
        // Understood, and waiting for the requester: not a failure, no failure email. The confirm step is not checkpointed,
        // so an approval (a later run of this job with the approval in its input) runs it again and continues from there.
        job = { ...job, status: "awaiting-approval", failure: undefined, updatedAt: now() };
        await deps.jobStore.save(job);
        return job;
      }
      if (!(e instanceof StepFailure)) {
        deps.logger.error("unexpected pipeline error", { jobId: job.id, step: currentStep, error: String(e) });
      }
      const failure = {
        step: currentStep,
        reason: boundReason(e instanceof Error ? e.message : String(e)),
        question: e instanceof StepFailure ? sanitizeQuestion(e.question) : undefined,
        ...(e instanceof StepFailure && e.code ? { code: e.code } : {}),
      };
      job = { ...job, status: "failed", failure, updatedAt: now() };
      await deps.jobStore.save(job);
      try {
        await deps.notifier.send(args.hooks.renderFailureEmail({ job }));
      } catch (notifyError) {
        // The job is already saved as failed; an email that cannot be sent must not turn that into a crash.
        deps.logger.error("failure email could not be sent", { jobId: job.id, error: notifyError instanceof Error ? notifyError.name : "unknown" });
      }
    }
    return job;
  }

  private async runStep(step: StepSpec, state: PipelineState, job: Job, hooks: PipelineHooks, hasVerify: boolean) {
    switch (step.kind) {
      case "inspect":
        return this.inspect(state, job.id, hooks);
      case "confirm":
        return this.confirm(step, state, job, hooks);
      case "generate":
        return this.generate(step, state, hooks);
      case "qa":
        return this.qa(step, state, hooks);
      case "publish":
        return this.publish(step, state, hooks, hasVerify);
      case "verify":
        return this.verify(step, state, job.id, hooks);
      case "notify":
        return this.notify(step, state, job, hooks);
      default:
        throw new StepFailure(`Unknown step kind "${step.kind}"`);
    }
  }

  private async inspect(state: PipelineState, jobId: string, hooks: PipelineHooks): Promise<void> {
    const { deps } = this;
    state.dirs = await deps.workspace.create(jobId);
    state.snapshots = [];
    for (const url of hooks.pages) {
      try {
        state.snapshots.push(await deps.inspector.snapshot(url));
      } catch (e) {
        throw new StepFailure(
          `Could not load ${url}: ${(e as Error).message}`,
          `We could not open ${url}. Is it public (not behind a login), and is the URL correct?`,
        );
      }
    }
    for (const [i, snap] of state.snapshots.entries()) {
      await deps.workspace.write(state.dirs.workspaceDir, pageSnapshotFile(i), snap.html);
    }
    await deps.workspace.write(
      state.dirs.workspaceDir,
      PAGE_CONTROLS_FILE,
      JSON.stringify(state.snapshots.map((s) => ({ url: s.url, controls: s.controls, ...(s.hiddenControls?.length ? { hiddenControls: s.hiddenControls } : {}) })), null, 2),
    );
  }

  /**
   * Understand the request and get the requester's approval before anything is built. The operation's `confirm` hook decides; this
   * step supplies what a hook cannot get alone: fresh page snapshots on a resumed job (so a page that changed after the requester
   * looked is seen) and, when the manifest names an `interpreter` agent, a reading of the description by that agent.
   */
  private async confirm(step: StepSpec, state: PipelineState, job: Job, hooks: PipelineHooks): Promise<void> {
    const { deps } = this;
    const dirs = state.dirs;
    if (!dirs) throw new StepFailure("Workspace was not prepared (inspect step missing?)");
    if (!hooks.confirm) throw new StepFailure("This operation cannot confirm with the requester (no confirm hook).");
    const previous = state.confirmation;
    let snapshots = state.snapshots;
    if (previous) {
      // A resumed job: read the pages again. The hook compares them with what the requester was shown.
      snapshots = [];
      for (const url of hooks.pages) {
        try {
          snapshots.push(await deps.inspector.snapshot(url));
        } catch (e) {
          throw new StepFailure(`Could not load ${url}: ${(e as Error).message}`, `We could not open ${url} again to check it has not changed. Is it still public, and is the URL correct?`);
        }
      }
    }
    let outcome = await hooks.confirm({ snapshots, ...(previous ? { previous } : {}) });
    if (outcome.kind === "needs-interpretation") {
      const agentId = str(step.config, "interpreter");
      const agent = agentId ? deps.agents.get(agentId) : undefined;
      if (!agentId || !agent) {
        throw new StepFailure("No interpretation of the request, and no interpreter agent is configured.", outcome.unreadable ? UNREADABLE_ANSWER_QUESTION : NEEDS_READER_QUESTION, AGENT_QUESTION_CODE);
      }
      const outDir = `${dirs.rootDir}/interpret-out`;
      let result: AgentRunResult;
      try {
        result = await agent.run({
          agent: agentId,
          prompt: outcome.prompt,
          contextDir: dirs.contextDir,
          workspaceDir: dirs.workspaceDir,
          outputDir: outDir,
          expectedOutputs: ["interpretation.json"],
          limits: { maxTurns: num(step.config, "maxTurns") ?? 8, timeoutMs: num(step.config, "timeoutMs") ?? STEP_DEFAULTS.timeoutMs },
          metadata: { purpose: "interpret" },
        });
      } catch (e) {
        result = { ok: false, exitStatus: -1, filesProduced: [], transcript: "", durationMs: 0, error: (e as Error).message };
      }
      if (!result.ok) {
        deps.logger.warn("interpreter agent failed", { agent: agentId, error: String(result.error ?? `exit ${result.exitStatus}`).slice(0, 500) });
        throw new StepFailure(`The interpreter agent failed: ${result.error ?? `exit ${result.exitStatus}`}`, READER_FAILED_QUESTION, READER_UNAVAILABLE_CODE);
      }
      const files = await deps.workspace.read(outDir, ["interpretation.json"]);
      outcome = await hooks.confirm({ snapshots, agentInterpretation: files["interpretation.json"] ?? null, ...(previous ? { previous } : {}) });
      if (outcome.kind === "needs-interpretation") {
        throw new StepFailure("The interpreter agent's answer could not be used.", READER_FAILED_QUESTION, READER_UNAVAILABLE_CODE);
      }
    }
    if (outcome.kind === "approved") {
      for (const [name, content] of Object.entries(outcome.files)) await deps.workspace.write(dirs.workspaceDir, name, content);
      if (state.confirmation) state.confirmation = { ...state.confirmation, approved: true };
      return;
    }
    if (outcome.kind === "needs-confirmation") {
      state.confirmation = outcome.confirmation;
      throw new AwaitingApproval();
    }
  }

  private async runAgent(config: Record<string, unknown>, state: PipelineState, prompt: string, hooks: PipelineHooks) {
    const dirs = state.dirs;
    if (!dirs) throw new StepFailure("Workspace was not prepared (inspect step missing?)");
    const primaryId = str(config, "agent") ?? "";
    const primary = this.deps.agents.get(primaryId);
    if (!primary) throw new StepFailure(`No agent adapter bound for "${primaryId}"`);
    const make = (agent: string): AgentTask => ({
      agent,
      prompt,
      contextDir: dirs.contextDir,
      workspaceDir: dirs.workspaceDir,
      outputDir: dirs.outputDir,
      expectedOutputs: hooks.expectedOutputs,
      limits: {
        // Per-run caps from the manifest (generate step; qa inherits them for repairs); the defaults are STEP_DEFAULTS.
        maxTurns: num(config, "maxTurns") ?? STEP_DEFAULTS.maxTurns,
        timeoutMs: num(config, "timeoutMs") ?? STEP_DEFAULTS.timeoutMs,
      },
      metadata: Object.fromEntries(Object.entries(hooks.vars)),
    });
    const attempt = async (runner: AgentRunner, agent: string): Promise<AgentRunResult> => {
      try {
        return await runner.run(make(agent));
      } catch (e) {
        return { ok: false, exitStatus: -1, filesProduced: [], transcript: "", durationMs: 0, error: (e as Error).message };
      }
    };
    let result = await attempt(primary, primaryId);
    const fallbackId = str(config, "fallback");
    // A refusal that carries a question is deliberate (the merchant must answer); a fallback agent must not override it.
    if (!result.ok && fallbackId && !result.question) {
      const fb = this.deps.agents.get(fallbackId);
      if (fb) {
        this.deps.logger.warn("primary agent failed; using fallback", { primary: primaryId, fallback: fallbackId });
        const primaryResult = result;
        const fallbackResult = await attempt(fb, fallbackId);
        // When both fail, keep the PRIMARY agent's reason (it is the one that read the request). The fallback's own text
        // (it may hold stderr, paths or billing messages) goes to the log only.
        if (!fallbackResult.ok) this.deps.logger.warn("fallback agent also failed", { fallback: fallbackId, error: String(fallbackResult.error ?? `exit ${fallbackResult.exitStatus}`).slice(0, 1000) });
        result = fallbackResult.ok ? fallbackResult : { ...primaryResult, error: `${primaryResult.error ?? `exit ${primaryResult.exitStatus}`} (fallback "${fallbackId}" also failed)` };
      }
    }
    if (!result.ok) {
      throw new StepFailure(`Agent run failed: ${result.error ?? `exit ${result.exitStatus}`}`, result.question, result.question ? AGENT_QUESTION_CODE : undefined);
    }
    const missing = hooks.expectedOutputs.filter((f) => !result.filesProduced.includes(f));
    if (missing.length > 0) throw new StepFailure(`Agent did not produce: ${missing.join(", ")}`);
  }

  private async generate(step: StepSpec, state: PipelineState, hooks: PipelineHooks): Promise<void> {
    const dirs = state.dirs;
    if (!dirs) throw new StepFailure("Workspace was not prepared (inspect step missing?)");
    const packId = str(step.config, "context");
    if (!packId) throw new StepFailure('generate step needs a "context" pack id');
    const pack = await this.deps.contextPack.materialize(packId, dirs.contextDir);
    state.contextVersion = pack.version;
    const prompt = hooks.renderGeneratePrompt({
      snapshots: state.snapshots,
      contextVersion: pack.version,
      expectedOutputs: hooks.expectedOutputs,
    });
    await this.runAgent(step.config, state, prompt, hooks);
  }

  private async qa(step: StepSpec, state: PipelineState, hooks: PipelineHooks): Promise<void> {
    const { deps } = this;
    const dirs = state.dirs;
    if (!dirs) throw new StepFailure("Workspace was not prepared");
    const gateNames = Array.isArray(step.config.gates) ? step.config.gates.map(String) : [];
    const maxRepairs = typeof step.config.maxRepairLoops === "number" ? step.config.maxRepairLoops : STEP_DEFAULTS.maxRepairLoops;
    const gates = gateNames.map((n) => {
      const g = deps.gates.get(n);
      if (!g) throw new StepFailure(`No quality gate bound for "${n}"`);
      return g;
    });

    for (let round = 0; ; round++) {
      const files = await deps.workspace.read(dirs.outputDir, hooks.expectedOutputs);
      const findings: Finding[] = [];
      for (const gate of gates) {
        const report = await gate.review({ files, context: hooks.qaContext });
        findings.push(...report.findings);
        if (!report.passed) break; // cheapest gate first; stop at the first failing gate
      }
      const failing = findings.filter((f) => f.severity === "error");
      const report: QaReport = { passed: failing.length === 0, findings };
      state.qa = report;
      state.repairRounds = round;
      if (report.passed) return;
      if (round >= maxRepairs) {
        const first = failing[0]!;
        deps.logger.warn("qa failed; details stay internal", { rule: first.rule, message: String(first.message).slice(0, 300) });
        throw new StepFailure(
          `QA failed after ${round} repair round(s): ${first.rule}: ${first.message}`,
          QA_FAILED_QUESTION, // fixed wording: rule names and lint text stay in the error (job record, stderr), never in a message to the merchant
        );
      }
      deps.logger.info("qa failed; repairing", { round: round + 1, errors: failing.length });
      const prompt = hooks.renderRepairPrompt({
        snapshots: state.snapshots,
        contextVersion: state.contextVersion ?? "unknown",
        expectedOutputs: hooks.expectedOutputs,
        findings: failing,
        round: round + 1,
      });
      await this.runAgent(step.config, state, prompt, hooks);
    }
  }

  private async publish(step: StepSpec, state: PipelineState, hooks: PipelineHooks, hasVerify: boolean): Promise<void> {
    const { deps } = this;
    const dirs = state.dirs;
    if (!dirs) throw new StepFailure("Workspace was not prepared");
    const keyTemplate = str(step.config, "key");
    if (!keyTemplate) throw new StepFailure('publish step needs a "key" template');
    const files = await deps.workspace.read(dirs.outputDir, hooks.expectedOutputs);
    const primary = files[hooks.primaryArtifact];
    if (primary === undefined) throw new StepFailure(`${hooks.primaryArtifact} is missing at publish`);

    const version = sha256(primary).slice(0, 12); // content-addressed, derived from the unstamped artifact
    const stamped = primary.split(hooks.versionPlaceholder).join(version);
    const vars = { ...hooks.vars, version };
    const primaryKey = fill(keyTemplate, vars);
    const keyFor = (name: string) => siblingKey(primaryKey, name);
    const ref = await deps.storage.put(primaryKey, stamped);
    for (const name of hooks.expectedOutputs.filter((n) => n !== hooks.primaryArtifact)) {
      const body = files[name];
      if (body !== undefined) await deps.storage.put(keyFor(name), body);
    }
    state.published = { version, sha256: ref.sha256, key: ref.key, url: ref.url, contextVersion: state.contextVersion ?? "unknown" };

    const pointerTemplate = str(step.config, "pointer");
    if (pointerTemplate) {
      const pointerKey = fill(pointerTemplate, vars);
      if (hasVerify) state.pendingPointer = pointerKey; // moved only after verification passes
      else await deps.storage.pin(pointerKey, { version, url: ref.url, sha256: ref.sha256 });
    }
  }

  private async verify(step: StepSpec, state: PipelineState, jobId: string, hooks: PipelineHooks): Promise<void> {
    const { deps } = this;
    const dirs = state.dirs;
    const published = state.published;
    if (!dirs || !published) throw new StepFailure("Nothing published to verify");
    const verifierId = str(step.config, "verifier") ?? "";
    const verifier = deps.verifiers.get(verifierId);
    if (!verifier) throw new StepFailure(`No verifier bound for "${verifierId}"`);

    const files = await deps.workspace.read(dirs.outputDir, hooks.expectedOutputs);
    const publishedPrimary = await deps.storage.get(published.key);
    const result = await verifier.verify({ jobId, files, version: published, input: hooks.verifyInput, publishedPrimary });
    state.verification = result;
    if (!result.ok) {
      // The pointer has not moved, so consumers keep the previous version.
      throw new StepFailure(`Verification failed: ${result.problems.join("; ")}`, result.question);
    }
    if (state.pendingPointer) {
      await deps.storage.pin(state.pendingPointer, { version: published.version, url: published.url, sha256: published.sha256 });
      state.pendingPointer = undefined;
    }
  }

  private async notify(step: StepSpec, state: PipelineState, job: Job, hooks: PipelineHooks): Promise<void> {
    const dirs = state.dirs;
    if (!dirs) throw new StepFailure("Workspace was not prepared");
    const files = await this.deps.workspace.read(dirs.outputDir, hooks.expectedOutputs);
    try {
      await this.deps.notifier.send(hooks.renderSuccessEmail({ job: { ...job, state }, files }));
    } catch (e) {
      if (str(step.config, "failure") !== "warn") throw e;
      // The script is already published and verified: keep the job succeeded and record why the email did not go out.
      this.deps.logger.warn("notify failed after publish; job kept succeeded", { jobId: job.id, error: e instanceof Error ? e.name : "unknown" });
      state.warnings = [...(state.warnings ?? []), `notify: ${e instanceof Error ? e.message : String(e)}`];
    }
  }
}
