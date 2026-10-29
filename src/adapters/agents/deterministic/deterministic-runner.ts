import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { AgentRunner, AgentRunResult, AgentTask } from "../../../ports/index.ts";

export type DeterministicBuild = (args: { prompt: string; inputs: Record<string, string>; metadata: Record<string, string> }) =>
  | { ok: true; files: Record<string, string>; summary?: string }
  | { ok: false; error: string; question?: string };

/**
 * An AgentRunner that is not an agent: it reads named files from the task's workspace, calls a pure build function
 * (injected by an operation's plugin), and writes the files it returns to the output folder. No model, no network.
 * All disk access lives here so the operation's own code stays pure.
 */
export class DeterministicRunner implements AgentRunner {
  constructor(
    private readonly opts: {
      inputs: string[];
      build: DeterministicBuild;
      /** Receives the real error text (paths, parser messages) that is deliberately kept out of the result. */
      onDetail?: (detail: string) => void;
    },
  ) {}

  async run(task: AgentTask): Promise<AgentRunResult> {
    const started = Date.now();
    const fail = (error: string, question?: string): AgentRunResult => ({ ok: false, exitStatus: 1, filesProduced: [], transcript: "", durationMs: Date.now() - started, error, ...(question ? { question } : {}) });
    const inputs: Record<string, string> = {};
    for (const name of this.opts.inputs) {
      const path = resolve(task.workspaceDir, name);
      if (!path.startsWith(resolve(task.workspaceDir) + sep)) return fail("the builder input is outside the workspace");
      try {
        inputs[name] = await readFile(path, "utf8");
      } catch (e) {
        this.opts.onDetail?.(`could not read workspace input ${name}: ${(e as Error).message}`);
        return fail("the builder could not read its input");
      }
    }
    let built: ReturnType<DeterministicBuild>;
    const buildStarted = Date.now();
    try {
      built = this.opts.build({ prompt: task.prompt, inputs, metadata: task.metadata ?? {} });
    } catch (e) {
      this.opts.onDetail?.(`the builder crashed: ${(e as Error).message}`);
      return fail("the builder crashed");
    }
    // A synchronous build cannot be interrupted from here (that needs a worker thread, which the dependency rule does not allow
    // in this layer); what is enforced is that a build that overran its time limit is not trusted or written.
    if (task.limits?.timeoutMs && Date.now() - buildStarted > task.limits.timeoutMs) {
      this.opts.onDetail?.(`the builder took ${Date.now() - buildStarted} ms (limit ${task.limits.timeoutMs} ms)`);
      return fail("the builder took too long");
    }
    if (!built.ok) return fail(built.error, built.question);
    try {
      await mkdir(task.outputDir, { recursive: true });
      const outRoot = resolve(task.outputDir);
      for (const [name, content] of Object.entries(built.files)) {
        const target = resolve(outRoot, name);
        if (!target.startsWith(outRoot + sep)) return fail("the builder output is outside the output folder");
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }
    } catch (e) {
      this.opts.onDetail?.(`could not write the builder output: ${(e as Error).message}`);
      return fail("the builder output could not be written");
    }
    return {
      ok: true,
      exitStatus: 0,
      filesProduced: (await readdir(task.outputDir)).sort(),
      transcript: built.summary ?? "deterministic build",
      costUsd: 0,
      durationMs: Date.now() - started,
    };
  }
}
