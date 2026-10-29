import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import type { AgentRunner, AgentRunResult, AgentTask } from "../../../ports/index.ts";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Process runner, injectable so the adapter is testable without the binary. */
export type Exec = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<ExecResult>;

export const nodeExec: Exec = (cmd, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });

export interface ClaudeCodeOptions {
  binary?: string;
  exec?: Exec;
  allowedTools?: string[];
  /** Hard cost cap per run (`--max-budget-usd`). Unset: no cap. */
  maxBudgetUsd?: number;
}

/**
 * AgentRunner backed by headless Claude Code (`claude -p`).
 * Network and filesystem isolation are NOT enforced here; run it inside a container with an egress allowlist.
 * Flags checked against `claude --help` (Claude Code 2.1.220): -p, --output-format, --permission-mode,
 * --allowedTools, --add-dir, --no-session-persistence, --max-budget-usd are listed; --max-turns is accepted
 * but not listed in --help (an unknown option errors, this one reports "argument missing"). Live run:
 * docs/verification/claude-code-live.md.
 */
export class ClaudeCodeAgent implements AgentRunner {
  private readonly binary: string;
  private readonly exec: Exec;
  private readonly allowedTools: string[];
  private readonly maxBudgetUsd: number | undefined;

  constructor(opts: ClaudeCodeOptions = {}) {
    this.binary = opts.binary ?? "claude";
    this.exec = opts.exec ?? nodeExec;
    this.allowedTools = opts.allowedTools ?? ["Read", "Write", "Edit", "Glob", "Grep"];
    this.maxBudgetUsd = opts.maxBudgetUsd;
  }

  async run(task: AgentTask): Promise<AgentRunResult> {
    await mkdir(task.outputDir, { recursive: true });
    const args = [
      "-p",
      task.prompt,
      "--output-format",
      "json",
      "--no-session-persistence",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      this.allowedTools.join(","),
      "--add-dir",
      task.contextDir,
      "--add-dir",
      task.outputDir,
    ];
    if (task.limits.maxTurns) args.push("--max-turns", String(task.limits.maxTurns));
    if (this.maxBudgetUsd) args.push("--max-budget-usd", String(this.maxBudgetUsd));

    const started = Date.now();
    const res = await this.exec(this.binary, args, { cwd: task.workspaceDir, timeoutMs: task.limits.timeoutMs });
    const filesProduced = (await readdir(task.outputDir).catch(() => [])).sort();

    let costUsd: number | undefined;
    let transcript = res.stdout;
    let reportedError: string | undefined;
    try {
      const parsed = JSON.parse(res.stdout) as { total_cost_usd?: number; result?: string; is_error?: boolean };
      costUsd = parsed.total_cost_usd;
      transcript = parsed.result ?? res.stdout;
      // `claude -p --output-format json` reports API failures (e.g. "Credit balance is too low") in `result` with is_error true.
      if (parsed.is_error) reportedError = parsed.result ?? "claude reported an error";
    } catch {
      // keep raw stdout
    }

    const ok = res.code === 0 && !res.timedOut && reportedError === undefined;
    const result: AgentRunResult = {
      ok,
      exitStatus: res.code ?? -1,
      filesProduced,
      transcript,
      costUsd,
      durationMs: Date.now() - started,
      ...(ok ? {} : { error: res.timedOut ? `timed out after ${task.limits.timeoutMs}ms` : reportedError ?? (res.stderr.trim() || `exit ${res.code}`) }),
    };
    return result;
  }
}
