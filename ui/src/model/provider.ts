import type { ModelUnusable } from "./errors";

export type { ModelInterpretation } from "./interpretation";

export interface ModelCapabilities {
  usable: boolean;
  reason?: ModelUnusable;
  modelId?: string;
  approxDownloadMB?: number;
  cached: boolean;
}

export interface ModelProvider {
  readonly providerId: string;
  capabilities(): Promise<ModelCapabilities>;
  /** Optional: is the model already on this browser? Providers that always have it (mocks) omit this and report `cached` in capabilities. */
  isCached?(): Promise<boolean>;
  ensureReady(
    onProgress?: (p: { fraction: number; stage: "download" | "load" }) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  generate(
    req: {
      system: string;
      user: string;
      maxTokens: number;
      temperature: number;
      seed?: number;
      jsonSchema?: string;
    },
    signal?: AbortSignal,
  ): Promise<{ rawText: string; modelId: string; ms: number }>;
  cancel(): void;
  unload(): Promise<void>;
}

