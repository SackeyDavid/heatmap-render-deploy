import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentRunner, AgentRunResult, AgentTask } from "../../../ports/index.ts";

export type FakeResponder = (task: AgentTask, callIndex: number) => Record<string, string> | Error;

/** Replaces {{key}} only for keys present in vars; other placeholders (e.g. {{SCRIPT_VERSION}}) survive. */
const substitute = (text: string, vars: Record<string, string>) =>
  text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, k: string) => vars[k] ?? m);

/**
 * Deterministic AgentRunner for tests and the default CLI. Either calls a responder, or serves the
 * expected output files from a fixture directory with {{var}} substitution from task metadata.
 */
export class FakeAgent implements AgentRunner {
  readonly calls: AgentTask[] = [];
  private readonly responder: FakeResponder | undefined;
  private readonly fixtureDir: string | undefined;
  /** Other output folders chosen by a job fact: metadata key -> value -> folder (for example platform -> shopify -> folder). */
  private readonly fixtureDirWhen: Record<string, Record<string, string>> | undefined;

  constructor(opts: { responder?: FakeResponder; fixtureDir?: string; fixtureDirWhen?: Record<string, Record<string, string>> } = {}) {
    this.responder = opts.responder;
    this.fixtureDir = opts.fixtureDir;
    this.fixtureDirWhen = opts.fixtureDirWhen;
  }

  private fixtureFor(task: AgentTask): string | undefined {
    for (const [key, byValue] of Object.entries(this.fixtureDirWhen ?? {})) {
      const value = task.metadata?.[key];
      if (value && byValue[value]) return byValue[value];
    }
    return this.fixtureDir;
  }

  private async respond(task: AgentTask, callIndex: number): Promise<Record<string, string> | Error> {
    if (this.responder) return this.responder(task, callIndex);
    const fixtureDir = this.fixtureFor(task);
    if (!fixtureDir) return new Error("FakeAgent has neither a responder nor a fixture directory");
    const out: Record<string, string> = {};
    for (const name of task.expectedOutputs) {
      try {
        out[name] = substitute(await readFile(join(fixtureDir, name), "utf8"), task.metadata ?? {});
      } catch {
        return new Error(`fixture ${name} not found in ${fixtureDir}`);
      }
    }
    return out;
  }

  async run(task: AgentTask): Promise<AgentRunResult> {
    const callIndex = this.calls.length;
    this.calls.push(task);
    const started = Date.now();
    const response = await this.respond(task, callIndex);
    if (response instanceof Error) {
      const failed: AgentRunResult = {
        ok: false,
        exitStatus: 1,
        filesProduced: [],
        transcript: "",
        durationMs: Date.now() - started,
        error: response.message,
      };
      return failed;
    }
    await mkdir(task.outputDir, { recursive: true });
    for (const [name, content] of Object.entries(response)) {
      const target = join(task.outputDir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    const result: AgentRunResult = {
      ok: true,
      exitStatus: 0,
      filesProduced: (await readdir(task.outputDir)).sort(),
      transcript: `fake agent call #${callIndex}`,
      costUsd: 0,
      durationMs: Date.now() - started,
    };
    return result;
  }
}
