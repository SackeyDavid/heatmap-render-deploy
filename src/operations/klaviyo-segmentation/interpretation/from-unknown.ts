import { type ModelInterpretation, modelInterpretationSchema, MAX_INTERPRETATION_BYTES } from "./schema.ts";

/** A stored interpretation (JSON text or value) that passes the schema, or undefined. Shape only: the request text is checked when it is approved. */
export function interpretationFromUnknown(raw: unknown): ModelInterpretation | undefined {
  try {
    const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    const text = JSON.stringify(value);
    if (text === undefined || Buffer.byteLength(text, "utf8") > MAX_INTERPRETATION_BYTES) return undefined;
    const parsed = modelInterpretationSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
