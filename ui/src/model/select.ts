import { MockModelProvider } from "./mock-provider";
import { NoneProvider } from "./none-provider";
import type { ModelProvider } from "./provider";
import { WebLlmBrowserProvider } from "./webllm-provider";

export type ModelSelect = "auto" | "webllm" | "mock" | "none";

export function createModelProvider(mode: ModelSelect, mockGoldens?: Record<string, { rawText: string }>): ModelProvider {
  if (mode === "mock") return new MockModelProvider({ goldens: mockGoldens });
  if (mode === "none") return new NoneProvider();
  if (mode === "webllm") return new WebLlmBrowserProvider();
  return new AutoModelProvider(mockGoldens);
}

class AutoModelProvider implements ModelProvider {
  readonly providerId = "auto";
  private delegate: ModelProvider | null = null;
  private readonly mockGoldens?: Record<string, { rawText: string }>;
  private predictiveMock: MockModelProvider | null = null;

  constructor(mockGoldens?: Record<string, { rawText: string }>) {
    this.mockGoldens = mockGoldens;
  }

  private async pick(): Promise<ModelProvider> {
    if (this.delegate) return this.delegate;
    const web = new WebLlmBrowserProvider();
    const caps = await web.capabilities();
    if (caps.usable) {
      this.delegate = web;
      return web;
    }
    this.delegate = new NoneProvider();
    return this.delegate;
  }

  async capabilities() {
    return (await this.pick()).capabilities();
  }

  async ensureReady(onProgress?: (p: { fraction: number; stage: "download" | "load" }) => void, signal?: AbortSignal) {
    return (await this.pick()).ensureReady(onProgress, signal);
  }

  async generate(req: Parameters<ModelProvider["generate"]>[0], signal?: AbortSignal) {
    return (await this.pick()).generate(req, signal);
  }

  cancel(): void {
    this.delegate?.cancel();
  }

  async unload(): Promise<void> {
    const d = this.delegate;
    if (!d) return;
    // A provider that is not holding a loaded model (a download in progress) declines to unload; it must stay reachable, or it becomes an
    // orphan that nothing can ever unload and the next call would start a second download.
    const loaded = (d as { isEngineLoaded?: () => boolean }).isEngineLoaded?.() ?? false;
    await d.unload();
    if (loaded) this.delegate = null;
  }

  isEngineLoaded(): boolean {
    const d = this.delegate as { isEngineLoaded?: () => boolean } | null;
    return d?.isEngineLoaded?.() ?? false;
  }

  async predictPromptTail(partial: string, signal?: AbortSignal): Promise<string | null> {
    const p = await this.pick();
    const loaded = p as { isEngineLoaded?: () => boolean; predictPromptTail?: (s: string, sig?: AbortSignal) => Promise<string | null> };
    if (loaded.isEngineLoaded?.()) {
      return loaded.predictPromptTail?.(partial, signal) ?? null;
    }
    if (!this.predictiveMock) {
      this.predictiveMock = new MockModelProvider({ goldens: this.mockGoldens });
    }
    return this.predictiveMock.predictPromptTail(partial, signal);
  }
}
