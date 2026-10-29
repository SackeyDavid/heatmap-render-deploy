import {
  extractJsonObjectFromText,
  interpretationJsonSchemaString,
  MAX_UNSUPPORTED,
  parseModelInterpretation,
  salvageAnswer,
  type ModelInterpretation,
} from "./interpretation";
import { buildInterpretPrompt, PROMPT_VERSION } from "./prompts/interpret.v1";
import type { ModelProvider } from "./provider";

export type InterpretOutcome =
  | { ok: true; interpretation: ModelInterpretation; rawText: string; ms: number; repairs: number }
  | { ok: false; reason: "parse" | "schema" | "provider" | "too-long"; detail?: string };

const MAX_GENERATIONS = 2;
const MAX_TOKENS = 600;
const SEED = 42;

export async function interpretRequest(
  provider: ModelProvider,
  request: string,
  pagePaths: string[],
  signal?: AbortSignal,
  onProgress?: (p: { fraction: number; stage: "download" | "load" }) => void,
): Promise<InterpretOutcome> {
  await provider.ensureReady(onProgress, signal);
  const { system, user } = buildInterpretPrompt(request, pagePaths);
  let repairs = 0;
  let lastError = "";

  for (let attempt = 0; attempt < MAX_GENERATIONS; attempt++) {
    const userMsg =
      attempt === 0
        ? user
        : `${user}\n\nPrevious output failed validation: ${lastError}. Return only valid JSON for the schema.`;
    let gen;
    try {
      gen = await provider.generate(
        {
          system,
          user: userMsg,
          maxTokens: MAX_TOKENS,
          temperature: 0,
          seed: SEED,
          jsonSchema: interpretationJsonSchemaString,
        },
        signal,
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.warn("[helper] generate failed:", detail);
      return { ok: false, reason: "provider", detail };
    }
    if (gen.rawText.length > 6000) {
      return { ok: false, reason: "too-long" };
    }
    const parsed = extractJsonObjectFromText(gen.rawText);
    let interpretation = parseModelInterpretation(parsed);
    if (!interpretation) {
      // One bad field (confidence in capitals, a target with a question mark, too many items) must not throw the whole answer away:
      // keep what is valid and say that part could not be read. Nothing usable left -> try once more, then give up.
      const salvaged = salvageAnswer(parsed);
      const partial = parseModelInterpretation(salvaged.value);
      if (partial && partial.behaviours.length > 0) {
        if (salvaged.droppedItems > 0 && partial.unsupported.length < MAX_UNSUPPORTED) {
          partial.unsupported = [...partial.unsupported, { evidence: "part of the answer", reason: "unreadable" }];
        }
        interpretation = partial;
      }
    }
    if (interpretation) {
      if (interpretation.behaviours.length === 0) console.warn("[helper] no behaviours in answer (length", gen.rawText.length + ")");
      if (!interpretation.promptVersion) interpretation.promptVersion = PROMPT_VERSION;
      return { ok: true, interpretation, rawText: gen.rawText, ms: gen.ms, repairs };
    }
    lastError = "schema-invalid";
    console.warn("[helper] answer did not match the schema (length", gen.rawText.length + ")");
    repairs++;
  }
  return { ok: false, reason: "schema", detail: lastError };
}
