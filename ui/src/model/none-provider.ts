import { completionSuffix, listLocalPromptSuggestions } from "./prompt-completer";
import type { ModelProvider } from "./provider";

export class NoneProvider implements ModelProvider {
  readonly providerId = "none";

  async capabilities() {
    return { usable: false, reason: "unsupported" as const, cached: false };
  }

  async ensureReady(): Promise<void> {
    return;
  }

  async generate(): Promise<{ rawText: string; modelId: string; ms: number }> {
    return {
      rawText: '{"schemaVersion":1,"promptVersion":"interpret-1","modelId":"none","behaviours":[],"unsupported":[]}',
      modelId: "none",
      ms: 0,
    };
  }

  cancel(): void {
    /* no-op */
  }

  async unload(): Promise<void> {
    return;
  }

  isEngineLoaded(): boolean {
    return true;
  }

  async predictPromptTail(partial: string, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted || !partial.trim() || partial.trim().length < 3) return null;
    const phrase = listLocalPromptSuggestions(partial, 1)[0];
    if (!phrase) return null;
    return completionSuffix(partial, phrase);
  }
}
