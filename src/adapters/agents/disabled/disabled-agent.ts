import type { AgentRunner, AgentRunResult, AgentTask } from "../../../ports/index.ts";

/**
 * An agent that must not run (no API-token spend). Declared in a manifest as `adapter: DisabledAgent` where a
 * real agent could otherwise be bound, e.g. the fallback agent of the local and production HTTP manifests.
 * Always reports a plain failure, never throws, and never touches the task's directories.
 */
export class DisabledAgent implements AgentRunner {
  async run(_task: AgentTask): Promise<AgentRunResult> {
    return { ok: false, exitStatus: 1, filesProduced: [], transcript: "", durationMs: 0, error: "this agent is disabled in this environment" };
  }
}
