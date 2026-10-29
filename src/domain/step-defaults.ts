/**
 * The defaults a manifest step falls back to when it does not set the option. One owner: the runner reads them here,
 * step-schemas.ts documents them, and a test pins them, so a default is never a number buried in code.
 */
export const STEP_DEFAULTS = {
  /** generate and qa-repair: how many agent turns one run may take. */
  maxTurns: 40,
  /** generate and qa-repair: how long one agent run may take. */
  timeoutMs: 600_000,
  /** qa: how many repair rounds before the job fails. */
  maxRepairLoops: 2,
} as const;
