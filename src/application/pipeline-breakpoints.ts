import { stepKind } from "../domain/step-id.ts";
import type { Logger } from "../ports/index.ts";

export type BreakpointMode = "log" | "pause";

export interface StepBreakpointContext {
  jobId: string;
  operation: string;
  stepId: string;
  phase: "before" | "after";
}

/** Optional pipeline step hooks for Kenn QA (env `HEATMAP_BREAKPOINT` or CLI `--breakpoint`). */
export interface PipelineBreakpointControl {
  shouldBreak(stepId: string): boolean;
  onStep(ctx: StepBreakpointContext): void | Promise<void>;
}

const normalizeToken = (t: string) => t.trim().toLowerCase();

/** Parses comma-separated step ids, kinds, `validate`, or `*` / `all`. */
export function parseBreakpointTokens(raw: string): Set<string> | "*" {
  const parts = raw
    .split(",")
    .map((p) => normalizeToken(p))
    .filter(Boolean);
  if (parts.length === 0) return new Set();
  if (parts.some((p) => p === "*" || p === "all")) return "*";
  return new Set(parts);
}

export function stepMatchesBreakpoint(stepId: string, tokens: Set<string> | "*"): boolean {
  if (tokens === "*") return true;
  const id = normalizeToken(stepId);
  const kind = stepKind(id);
  for (const t of tokens) {
    if (t === id || t === kind) return true;
    if (id.endsWith(`:${t}`)) return true;
  }
  return false;
}

/** For tests and CLI: explicit token list + mode. */
export function createBreakpointControl(opts: {
  tokens: Set<string> | "*";
  mode: BreakpointMode;
  logger: Logger;
  onStep?: (ctx: StepBreakpointContext) => void | Promise<void>;
}): PipelineBreakpointControl {
  return {
    shouldBreak: (stepId) => stepMatchesBreakpoint(stepId, opts.tokens),
    async onStep(ctx) {
      if (!stepMatchesBreakpoint(ctx.stepId, opts.tokens)) return;
      if (opts.onStep) {
        await opts.onStep(ctx);
        return;
      }
      if (opts.mode === "log") {
        opts.logger.info("pipeline breakpoint", { ...ctx, breakpoint: true });
      }
    },
  };
}
