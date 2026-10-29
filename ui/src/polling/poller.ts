import { PAUSED, TERMINAL, type RequestView } from '../api/contract';
import type { ApiFailure, ApiResult } from '../api/client';

export interface PollerOptions {
  fetchOnce: () => Promise<ApiResult<RequestView>>;
  onUpdate: (view: RequestView) => void;
  /** Called once when polling ends: terminal result, a failure that will not fix itself, or giving up. */
  onDone: (outcome: PollOutcome) => void;
  /** Called on a temporary problem that we will retry. */
  onRetrying?: () => void;
  /** Wait times in ms; the last one repeats. Default backs off 2s, 2s, 3s, 5s, 8s, 10s. */
  delays?: number[];
  /** Give up after this many ms in total. Default 10 minutes. */
  maxTotalMs?: number;
  /** Give up after this many network/server problems in a row. Default 5. */
  maxConsecutiveErrors?: number;
}

export type PollOutcome =
  | { kind: 'terminal'; view: RequestView }
  /** The server understood the request and waits for the merchant to approve it. */
  | { kind: 'needs-confirmation'; view: RequestView }
  | { kind: 'error'; error: ApiFailure }
  | { kind: 'timeout' };

export const DEFAULT_DELAYS = [2000, 2000, 3000, 5000, 8000, 10000];
const GIVE_UP_CODES = ['unauthenticated', 'reauth-required', 'forbidden', 'not-found'];

export function startPolling(opts: PollerOptions): () => void {
  const delays = opts.delays ?? DEFAULT_DELAYS;
  const maxTotalMs = opts.maxTotalMs ?? 10 * 60 * 1000;
  const maxErrors = opts.maxConsecutiveErrors ?? 5;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tick = 0;
  let errors = 0;
  let elapsed = 0;

  const finish = (outcome: PollOutcome): void => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    opts.onDone(outcome);
  };

  const schedule = (): void => {
    const delay = delays[Math.min(tick, delays.length - 1)] ?? 10000;
    tick += 1;
    elapsed += delay;
    if (elapsed > maxTotalMs) {
      finish({ kind: 'timeout' });
      return;
    }
    timer = setTimeout(run, delay);
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    const res = await opts.fetchOnce();
    if (stopped) return;
    if (res.ok) {
      errors = 0;
      if ((TERMINAL as readonly string[]).includes(res.data.status)) {
        finish({ kind: 'terminal', view: res.data });
        return;
      }
      if ((PAUSED as readonly string[]).includes(res.data.status)) {
        finish({ kind: 'needs-confirmation', view: res.data });
        return;
      }
      opts.onUpdate(res.data);
    } else if (GIVE_UP_CODES.includes(res.error.code)) {
      finish({ kind: 'error', error: res.error });
      return;
    } else {
      errors += 1;
      if (errors >= maxErrors) {
        finish({ kind: 'error', error: res.error });
        return;
      }
      opts.onRetrying?.();
    }
    schedule();
  };

  // First check soon after submit (first delay), then back off.
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
