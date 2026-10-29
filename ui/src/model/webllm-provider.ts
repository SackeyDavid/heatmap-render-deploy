import { ModelAborted, ModelTimeout, ModelUnavailable } from "./errors";
import { interpretationJsonSchemaString } from "./interpretation";
import type { ModelProvider } from "./provider";

// Small model (about 0.9 GB first download, then cached in the browser). Phi-3.5-mini (2.2 GB) took too long to download.
const SHIPPED_MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
// Local testing only: ?helperModel=<WebLLM model id> tries another model without a code edit.
const DEFAULT_MODEL =
  (import.meta.env.DEV && new URLSearchParams(globalThis.location?.search ?? "").get("helperModel")) || SHIPPED_MODEL;
// First-run WebLLM setup includes a large model download plus GPU engine
// compilation. Keep the deadline long enough for a slower client connection
// without changing the request-generation timeout.
const LOAD_TIMEOUT_MS = 60 * 60 * 1000;

type EngineLike = {
  interruptGenerate?: () => void;
  resetChat?: () => Promise<void>;
  chat: {
    completions: {
      create: (opts: Record<string, unknown>) => Promise<{ choices: { message: { content?: string }; finish_reason?: string }[] }>;
    };
  };
};

type WorkerLike = { terminate(): void };

/** The real loader: the web-llm library, in the given worker. */
async function realCreateEngine(worker: WorkerLike, onProgress: (fraction: number) => void): Promise<EngineLike> {
  const mod = await import("@mlc-ai/web-llm");
  const create = mod.CreateWebWorkerMLCEngine as unknown as (
    worker: Worker,
    model: string,
    opts: { initProgressCallback?: (p: { progress: number }) => void },
  ) => Promise<EngineLike>;
  return create(worker as unknown as Worker, DEFAULT_MODEL, { initProgressCallback: (p) => onProgress(p.progress) });
}
export interface WebLlmProviderOptions {
  /** Tests: a stand-in for the Web Worker that downloads and runs the model. */
  createWorker?: () => WorkerLike;
  /** Tests: a stand-in for the engine loader (the real one downloads about 0.9 GB). */
  createEngine?: (worker: WorkerLike, onProgress: (fraction: number) => void) => Promise<EngineLike>;
}

export class WebLlmBrowserProvider implements ModelProvider {
  readonly providerId = "webllm";
  /** The worker of a load in progress: ended when the load is cancelled, so a cancelled download really stops. */
  private worker: WorkerLike | null = null;
  /** Bumped by every load and every cancel: progress from an older load is ignored. */
  private loadToken = 0;
  constructor(private readonly opts: WebLlmProviderOptions = {}) {}
  private engine: EngineLike | null = null;
  private loading: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  // interruptGenerate() stops whatever the engine is running, not just the caller's request. A typing suggestion being cancelled
  // at submit must never cut the real interpretation short (it came back empty), so the two take turns.
  private predicting: Promise<unknown> | null = null;
  private generating = false;
  /** A typing suggestion was interrupted: the engine may still hold that interrupt until it is reset. */
  private interruptLeft = false;

  async capabilities() {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) {
      return { usable: false, reason: "no-webgpu" as const, cached: false };
    }
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      if (!adapter) {
        return { usable: false, reason: "no-webgpu" as const, cached: false };
      }
    } catch {
      return { usable: false, reason: "no-webgpu" as const, cached: false };
    }
    return {
      usable: true,
      modelId: DEFAULT_MODEL,
      approxDownloadMB: 900,
      cached: this.engine !== null,
    };
  }

  /** Is the model already on this browser (no download needed)? Asked only when needed; unknown or slow counts as no. */
  async isCached(): Promise<boolean> {
    if (this.engine) return true;
    try {
      const check = (async () => (await import("@mlc-ai/web-llm")).hasModelInCache(DEFAULT_MODEL))();
      return await Promise.race([check, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000))]);
    } catch {
      return false;
    }
  }

  async ensureReady(
    onProgress?: (p: { fraction: number; stage: "download" | "load" }) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new ModelAborted();
    if (this.engine) return;
    if (this.loading) {
      if (signal?.aborted) throw new ModelAborted();
      return this.loading;
    }
    this.loading = this.loadEngine(onProgress, signal);
    return this.loading;
  }

  private async loadEngine(
    onProgress?: (p: { fraction: number; stage: "download" | "load" }) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutGate = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new ModelTimeout("Loading the helper took too long.")), LOAD_TIMEOUT_MS);
    });
    timeoutGate.catch(() => undefined);
    const abortEarly = signal
      ? new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new ModelAborted());
          signal.addEventListener("abort", () => reject(new ModelAborted()), { once: true });
        })
      : null;
    const token = ++this.loadToken;
    const report: typeof onProgress = (p) => {
      if (token === this.loadToken) onProgress?.(p);
    };
    try {
      report({ fraction: 0.1, stage: "download" });
      const create = this.opts.createEngine ?? realCreateEngine;
      const enginePromise = create(this.startWorker(), (fraction) => report({ fraction: Math.min(0.95, fraction), stage: "load" }));
      this.engine = (await Promise.race(
        abortEarly ? [enginePromise, timeoutGate, abortEarly] : [enginePromise, timeoutGate],
      )) as EngineLike;
      // Warm-up: the first request after loading compiles the GPU programs (about 15 s). Do it now, inside "Setting up the helper…",
      // so the merchant's first real request and first typing suggestion are as fast as the rest.
      try {
        // Warm the structured-output (JSON schema) path too: its first use is the slow one (about 15 s).
        const warm = this.engine.chat.completions.create({
          messages: [{ role: "user", content: "Tell me when someone opens a FAQ." }],
          max_tokens: 8,
          temperature: 0,
          response_format: { type: "json_object", schema: interpretationJsonSchemaString },
        });
        await Promise.race([warm, new Promise<void>((resolve) => setTimeout(resolve, 45_000))]);
      } catch {
        /* warm-up is best effort */
      }
      report({ fraction: 1, stage: "load" });
      if (signal?.aborted) throw new ModelAborted();
    } catch (e) {
      // A load that did not finish (cancelled, timed out, failed) must not keep downloading in the background.
      // (only this load's own worker: a late settle of an older load must not end a newer load's worker)
      if (!this.engine && token === this.loadToken) this.stopWorker();
      if (e instanceof ModelAborted || e instanceof ModelTimeout) throw e;
      throw new ModelUnavailable("Could not load the in-browser helper.", "load-failed");
    } finally {
      if (timeout) clearTimeout(timeout);
      this.loading = null;
    }
  }

  async generate(
    req: {
      system: string;
      user: string;
      maxTokens: number;
      temperature: number;
      seed?: number;
      jsonSchema?: string;
    },
    signal?: AbortSignal,
  ): Promise<{ rawText: string; modelId: string; ms: number }> {
    await this.ensureReady(undefined, signal);
    if (!this.engine) throw new ModelUnavailable("Helper not ready.");
    const engine = this.engine;
    this.abortController = new AbortController();
    const abortGate = new Promise<never>((_, reject) => {
      const stop = () => {
        engine.interruptGenerate?.();
        reject(new ModelAborted());
      };
      if (signal?.aborted) stop();
      else signal?.addEventListener("abort", stop, { once: true });
    });
    abortGate.catch(() => undefined);
    const started = performance.now();
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      seed: req.seed,
    };
    if (req.jsonSchema) {
      body.response_format = { type: "json_object", schema: req.jsonSchema };
    }
    // Take the engine first so no new typing suggestion can start, then stop the one in flight, let it settle, and clear the interrupt it
    // leaves behind: an interrupt left on the engine ends the next request at once with an empty "abort" answer.
    this.generating = true;
    let res;
    try {
      if (this.predicting) {
        engine.interruptGenerate?.();
        this.interruptLeft = true;
        await this.predicting.catch(() => undefined);
      }
      if (this.interruptLeft) {
        this.interruptLeft = false;
        await engine.resetChat?.().catch(() => undefined);
      }
      res = await Promise.race([engine.chat.completions.create(body), abortGate]);
    } finally {
      this.generating = false;
    }
    let choice = res.choices[0];
    if (!(choice?.message.content ?? "").trim() && choice?.finish_reason !== "length") {
      // An empty answer means the engine is in a bad state (an earlier interrupt). Reset it and ask once more.
      await engine.resetChat?.().catch(() => undefined);
      // The structured-output (JSON schema) mode is what gets stuck, so the retry goes without it; the caller's parser reads the JSON.
      const { response_format: _stuck, ...plain } = body;
      this.generating = true;
      try {
        res = await Promise.race([engine.chat.completions.create(plain), abortGate]);
      } finally {
        this.generating = false;
      }
      choice = res.choices[0];
      console.warn("[helper] empty answer, retried after reset; finish_reason:", choice?.finish_reason, "len:", (choice?.message.content ?? "").length);
    }
    const rawText = choice?.message.content ?? "";
    if (choice?.finish_reason === "length") {
      throw new ModelUnavailable("Output truncated.", "load-failed");
    }
    return { rawText, modelId: DEFAULT_MODEL, ms: Math.round(performance.now() - started) };
  }

  cancel(): void {
    this.abortController?.abort();
    if (this.loading && !this.engine) {
      this.loadToken++;
      this.stopWorker();
    }
    this.loading = null;
  }

  private startWorker(): WorkerLike {
    this.stopWorker();
    const worker = this.opts.createWorker ? this.opts.createWorker() : (new Worker(new URL("./webllm.worker", import.meta.url), { type: "module" }) as WorkerLike);
    this.worker = worker;
    return worker;
  }

  private stopWorker(): void {
    try {
      this.worker?.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
  }

  async unload(): Promise<void> {
    // A download or load still in progress is left alone: the idle and hidden-tab timers must never end a first download (it can take
    // many minutes) and leave the helper stuck. Only a model that is loaded is freed.
    if (!this.engine) return;
    this.engine = null;
    this.loading = null;
    this.loadToken++;
    // Calls to the ended worker never answer: forget them, so the next load does not wait on them.
    this.predicting = null;
    this.generating = false;
    this.interruptLeft = false;
    // The worker holds the model in memory: end it, so unloading really frees the memory.
    this.stopWorker();
  }

  /** True when the model is loaded — used for lightweight predictive typing (no download). */
  isEngineLoaded(): boolean {
    return this.engine !== null;
  }

  /** Finish the merchant's sentence; never calls ensureReady (submit helper owns full load). */
  async predictPromptTail(partial: string, signal?: AbortSignal): Promise<string | null> {
    if (!this.engine || signal?.aborted) return null;
    const engine = this.engine;
    if (this.generating) return null;
    const stop = () => {
      if (this.generating) return;
      engine.interruptGenerate?.();
      this.interruptLeft = true;
    };
    signal?.addEventListener('abort', stop, { once: true });
    const body: Record<string, unknown> = {
      messages: [
        {
          role: 'system',
          content:
            'You finish a shop owner\'s sentence about what to track on their website. Reply with ONLY the next 3 to 8 words that finish the sentence, then a full stop. Do not repeat words already written. No quotes, no explanation.',
        },
        { role: 'user', content: 'Tell me when a visitor clicks' },
        { role: 'assistant', content: 'the Add to cart button.' },
        { role: 'user', content: 'Let me know when someone opens' },
        { role: 'assistant', content: 'the size guide.' },
        { role: 'user', content: 'Fire when a visitor scrolls' },
        { role: 'assistant', content: 'halfway down the page.' },
        { role: 'user', content: partial },
      ],
      temperature: 0.5,
      top_p: 0.9,
      max_tokens: 20,
    };
    let res;
    const call = engine.chat.completions.create(body);
    this.predicting = call;
    try {
      res = await call;
    } finally {
      if (this.predicting === call) this.predicting = null;
      signal?.removeEventListener('abort', stop);
    }
    if (signal?.aborted) return null;
    const choice = res.choices[0];
    let rawText = choice?.message.content ?? '';
    // Hit the short length cap: keep whole words only.
    if (choice?.finish_reason === 'length') rawText = rawText.replace(/\s+\S*$/, '');
    const tail = rawText.replace(/^[\s"'`]+|[\s"'`]+$/g, '').trim();
    return cleanModelTail(partial, tail);
  }
}

/** Rejects rambling, repeating or off-topic completions; returns the text to append (with a leading space when needed) or null. */
export function cleanModelTail(partial: string, rawTail: string): string | null {
  let tail = rawTail.split(/\r?\n/)[0]!.trim();
  if (!tail || tail.length > 90 || !/[a-z]/i.test(tail)) return null;
  // The model sometimes restates the whole sentence: keep only what comes after what was typed.
  if (tail.toLowerCase().startsWith(partial.trim().toLowerCase())) tail = tail.slice(partial.trim().length).trim();
  if (!tail) return null;
  const words = tail.split(/\s+/);
  if (words.length > 10) return null;
  if (/\b(such as|for example|e\.g\.|you can|this is|i )/i.test(tail)) return null;
  if (/^(tell me|let me know|fire when|notify me)\b/i.test(tail)) return null;
  const typedWords = partial.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const repeated = words.filter((w) => typedWords.includes(w.toLowerCase().replace(/[^a-z]/g, ''))).length;
  if (repeated >= 2) return null;
  const joiner = /\s$/.test(partial) ? '' : ' ';
  return `${joiner}${tail.replace(/^[a-z]/i, (c) => c.toLowerCase())}`;
}
