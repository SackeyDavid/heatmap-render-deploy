import { createInterface } from "node:readline";
import { ConsoleLogger } from "../adapters/system.ts";
import {
  createBreakpointControl,
  parseBreakpointTokens,
  type BreakpointMode,
  type PipelineBreakpointControl,
} from "../application/pipeline-breakpoints.ts";
import type { Logger } from "../ports/index.ts";

async function pauseForHuman(stepId: string): Promise<void> {
  process.stderr.write(`[heatmap breakpoint] paused at "${stepId}". Press Enter to continue…\n`);
  if (!process.stdin.isTTY) {
    await new Promise((r) => setTimeout(r, 50));
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  await new Promise<void>((resolve) => {
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

function controlFromTokens(
  tokens: ReturnType<typeof parseBreakpointTokens>,
  mode: BreakpointMode,
  logger: Logger,
): PipelineBreakpointControl | undefined {
  if (tokens !== "*" && tokens.size === 0) return undefined;
  return createBreakpointControl({
    tokens,
    mode,
    logger,
    onStep:
      mode === "pause"
        ? async (ctx) => {
            await pauseForHuman(`${ctx.phase}:${ctx.stepId}`);
            logger.info("pipeline breakpoint (continued)", { ...ctx, breakpoint: true });
          }
        : undefined,
  });
}

/** Env-driven breakpoints for serve/stack (composition may use I/O helpers). */
export function createBreakpointsFromEnv(env: NodeJS.ProcessEnv, logger: Logger = new ConsoleLogger()): PipelineBreakpointControl | undefined {
  const raw = env.HEATMAP_BREAKPOINT?.trim();
  if (!raw) return undefined;
  const mode: BreakpointMode = env.HEATMAP_BREAKPOINT_MODE?.trim().toLowerCase() === "pause" ? "pause" : "log";
  return controlFromTokens(parseBreakpointTokens(raw), mode, logger);
}

/** CLI `--breakpoint` / `--breakpoint-mode` (entrypoints call this, not application directly). */
export function createCliBreakpointControl(raw: string, mode: BreakpointMode): PipelineBreakpointControl {
  return controlFromTokens(parseBreakpointTokens(raw), mode, new ConsoleLogger())!;
}
