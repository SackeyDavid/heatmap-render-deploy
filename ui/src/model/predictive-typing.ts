import {
  completionSuffix,
  listLocalPromptSuggestions,
  normalizePromptKey,
} from './prompt-completer';
import type { ModelProvider } from './provider';

export const PREDICTIVE_DEBOUNCE_MS = 350;
export const PREDICTIVE_MODEL_TIMEOUT_MS = 4000;
export const PREDICTIVE_MIN_CHARS = 3;

export type PredictiveCapable = ModelProvider & {
  isEngineLoaded?: () => boolean;
  predictPromptTail?: (partial: string, signal?: AbortSignal) => Promise<string | null>;
};

export type PredictiveCompletion = {
  /** Suffix to show as inline ghost (may start with a space). */
  tail: string;
  /** Full text after Tab accept. */
  full: string;
  /** Where it came from: the helper (model) or the built-in list of common requests. */
  source?: 'model' | 'phrase';
};

function completionFromPhrase(input: string, phrase: string): PredictiveCompletion | null {
  const suffix = completionSuffix(input, phrase);
  if (suffix !== null) {
    return { tail: suffix, full: input + suffix, source: 'phrase' };
  }
  if (!input.trim()) {
    return { tail: phrase, full: phrase, source: 'phrase' };
  }
  return null;
}

function localCompletions(input: string, limit = 3): PredictiveCompletion[] {
  const phrases = listLocalPromptSuggestions(input, limit);
  const out: PredictiveCompletion[] = [];
  for (const phrase of phrases) {
    const c = completionFromPhrase(input, phrase);
    if (c && !out.some((x) => normalizePromptKey(x.full) === normalizePromptKey(c.full))) {
      out.push(c);
    }
  }
  return out;
}

async function tryModelTail(
  provider: PredictiveCapable,
  input: string,
  signal: AbortSignal,
): Promise<PredictiveCompletion | null> {
  if (!input.trim() || input.trim().length < PREDICTIVE_MIN_CHARS) return null;
  if (!provider.predictPromptTail) return null;
  if (provider.isEngineLoaded && !provider.isEngineLoaded()) return null;

  const linked = new AbortController();
  const stop = () => linked.abort();
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => linked.abort(), PREDICTIVE_MODEL_TIMEOUT_MS);

  try {
    const tail = await provider.predictPromptTail(input, linked.signal);
    if (signal.aborted || !tail) return null;
    const full = input + tail;
    return { tail, full, source: 'model' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

export type PredictiveFetchResult = {
  active: PredictiveCompletion | null;
  alternatives: PredictiveCompletion[];
};

/** Debounced inline completion: model tail first (mock / loaded WebLLM), then local phrase fallback. */
export async function fetchPredictiveCompletion(
  provider: ModelProvider,
  input: string,
  signal: AbortSignal,
): Promise<PredictiveFetchResult> {
  if (signal.aborted) return { active: null, alternatives: [] };

  const local = localCompletions(input, 3);
  const model = await tryModelTail(provider as PredictiveCapable, input, signal);
  if (signal.aborted) return { active: null, alternatives: [] };

  // Merchant is in the middle of a word ("delet"): the built-in list finishes real words reliably, the small model does not.
  const midWord = !/\s$/.test(input) && local[0] && /^[a-z]/i.test(local[0].tail);
  if (model && midWord) {
    return { active: local[0]!, alternatives: [local[0]!, model, ...local.slice(1)].slice(0, 3) };
  }

  if (model) {
    const normModel = normalizePromptKey(model.full);
    const rest = local.filter((c) => normalizePromptKey(c.full) !== normModel);
    return { active: model, alternatives: [model, ...rest].slice(0, 3) };
  }

  return {
    active: local[0] ?? null,
    alternatives: local,
  };
}

/** @deprecated Use fetchPredictiveCompletion — kept for tests migrating from chip list API. */
export async function fetchPredictiveSuggestions(
  provider: ModelProvider,
  input: string,
  signal: AbortSignal,
): Promise<string[]> {
  const { alternatives } = await fetchPredictiveCompletion(provider, input, signal);
  return alternatives.map((c) => c.full);
}
