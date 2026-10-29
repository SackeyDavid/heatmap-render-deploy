import { validateInterpretation } from '../browser-model/validate-interpretation';
import { ModelAborted, ModelTimeout, ModelUnavailable } from './errors';
import type { ModelInterpretation } from './interpretation';
import { interpretRequest } from './interpret-service';
import type { ModelProvider } from './provider';

/**
 * Max time on “Reading your words…” for the in-browser helper. The first
 * structured generation may still be compiling WebGPU programs after the
 * model has loaded, so eight seconds is too short for a real client browser.
 */
export const MERCHANT_INTERPRET_TIMEOUT_MS = 60_000;

/** Runs the in-browser helper for one submit; server re-validates whatever we send. */
function pagePaths(urls: string[]): string[] {
  return urls.map((u) => {
    try {
      return new URL(u).pathname || '/';
    } catch {
      return '/';
    }
  });
}

export async function runMerchantInterpret(
  provider: ModelProvider,
  prompt: string,
  pageUrls: string[],
  signal?: AbortSignal,
  onProgress?: (p: { fraction: number; stage: 'download' | 'load' }) => void,
  timeoutMs: number = MERCHANT_INTERPRET_TIMEOUT_MS,
): Promise<ModelInterpretation | null> {
  if (signal?.aborted) return null;

  const linked = new AbortController();
  const stop = () => linked.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          linked.abort();
        }, timeoutMs)
      : undefined;

  try {
    const out = await interpretRequest(provider, prompt, pagePaths(pageUrls), linked.signal, onProgress);
    if (!out.ok) return null;
    const checked = validateInterpretation(out.interpretation, prompt, pageUrls);
    if (!checked.ok) return null;
    return checked.interpretation;
  } catch (e) {
    if (
      e instanceof ModelAborted ||
      e instanceof ModelTimeout ||
      e instanceof ModelUnavailable ||
      linked.signal.aborted
    ) {
      return null;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
