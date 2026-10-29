import { completionSuffix, listLocalPromptSuggestions } from "./prompt-completer";
import { ModelAborted, ModelTimeout, ModelUnavailable } from "./errors";
import type { ModelProvider } from "./provider";

export type MockMode = "normal" | "timeout" | "abort" | "slow" | "garbage";

type GoldenEntry = { rawText: string };

export interface MockModelProviderOptions {
  goldens?: Record<string, GoldenEntry>;
  mode?: MockMode;
  delayMs?: number;
}

function normalizeKey(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

export class MockModelProvider implements ModelProvider {
  readonly providerId = "mock";
  /** Tests set this to pretend the model is (not) already on the browser; unset, `capabilities().cached` (true) is used. */
  isCached?: () => Promise<boolean>;
  private ready = false;
  private genCount = 0;

  constructor(private readonly opts: MockModelProviderOptions = {}) {}

  async capabilities() {
    return { usable: true, modelId: "mock", cached: true, approxDownloadMB: 0 };
  }

  async ensureReady(
    onProgress?: (p: { fraction: number; stage: "download" | "load" }) => void,
  ): Promise<void> {
    onProgress?.({ fraction: 0.5, stage: "download" });
    onProgress?.({ fraction: 1, stage: "load" });
    this.ready = true;
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
    if (!this.ready) await this.ensureReady();
    const mode = this.opts.mode ?? "normal";
    if (signal?.aborted) throw new ModelAborted();
    if (mode === "timeout") throw new ModelTimeout();
    if (mode === "abort") throw new ModelAborted();
    if (mode === "slow") {
      await new Promise<void>((resolve, reject) => {
        const delay = this.opts.delayMs ?? 50;
        const timer = setTimeout(resolve, delay);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new ModelAborted());
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
    this.genCount++;
    if (mode === "garbage") {
      return { rawText: "not json at all {{{", modelId: "mock", ms: 1 };
    }
    const key = normalizeKey(req.user.replace(/<merchant_request>[\s\S]*<\/merchant_request>/i, "").trim());
    const innerMatch = req.user.match(/<merchant_request>\s*([\s\S]*?)\s*<\/merchant_request>/i);
    const requestBody = innerMatch?.[1] ? normalizeKey(innerMatch[1]) : key;
    const golden = this.opts.goldens?.[requestBody];
    const rawText =
      golden?.rawText ??
      '{"schemaVersion":1,"promptVersion":"interpret-1","modelId":"mock","behaviours":[],"unsupported":[]}';
    if (rawText.length > req.maxTokens * 4) {
      throw new ModelUnavailable("Output too long for mock");
    }
    return { rawText, modelId: "mock", ms: 2 };
  }

  cancel(): void {
    /* mock has nothing to cancel */
  }

  async unload(): Promise<void> {
    this.ready = false;
  }

  generationCount(): number {
    return this.genCount;
  }

  /** Mock LLM tail — phrase completion without interpret `generate`. */
  isEngineLoaded(): boolean {
    return true;
  }

  async predictPromptTail(partial: string, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return null;
    const mode = this.opts.mode ?? "normal";
    if (mode === "timeout" || mode === "abort") return null;
    if (!partial.trim() || partial.trim().length < 3) return null;

    await new Promise<void>((resolve, reject) => {
      const delay = mode === "slow" ? (this.opts.delayMs ?? 30) : 6;
      const timer = setTimeout(resolve, delay);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new ModelAborted());
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    if (signal?.aborted) return null;
    const phrase = listLocalPromptSuggestions(partial, 1)[0];
    if (!phrase) return null;
    const suffix = completionSuffix(partial, phrase);
    return suffix;
  }
}
