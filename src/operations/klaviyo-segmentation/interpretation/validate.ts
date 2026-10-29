import {
  CONFIDENCES,
  type InterpretedBehaviour,
  interpretedBehaviourSchema,
  MAX_BEHAVIOURS,
  MAX_INTERPRETATION_BYTES,
  MAX_UNSUPPORTED,
  type ModelInterpretation,
  modelInterpretationSchema,
  unsupportedEntrySchema,
} from "./schema.ts";
import { notAClickReason } from "./not-a-click.ts";
import { evidenceInRequest, normalizeRequestText, targetTokensSubsetOfRequest } from "./text-utils.ts";

/**
 * VALIDATES a model's interpretation. This is not language understanding: it checks shape, size, character sets, that the model
 * quoted the merchant's words (evidence) and used only the merchant's words for names, and that scroll depths are numbers.
 * Whatever passes is still checked against the real page (match-controls.ts) before anything is built.
 */
export type InterpretationRejectReason =
  | "interpretation-bytes"
  | "interpretation-schema"
  | "interpretation-evidence"
  | "interpretation-target-tokens"
  | "interpretation-kind-param"
  | "interpretation-charset";

export type ValidateInterpretationResult =
  | { ok: true; interpretation: ModelInterpretation; dropped: { index: number; reason: InterpretationRejectReason }[] }
  | { ok: false; reason: InterpretationRejectReason; detail?: string };

/**
 * One bad field in a model's answer must not throw the whole answer away. Before the strict check: the confidence is lower-cased
 * ("HIGH" -> "high", anything else is left out), every behaviour and every "not supported" entry is checked on its own and the
 * ones that do not fit the schema are dropped (and counted), and behaviours beyond the cap are dropped. What is left is still
 * checked strictly by the schema, so nothing looser than before can reach the builder.
 */
/** A small model often writes an unused optional field as "" (for example "heading":""); that means "not given". */
function withoutBlankFields(item: unknown): unknown {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, v]) => !(typeof v === "string" && v.trim() === "")));
}

export function salvageAnswer(value: unknown): { value: unknown; dropped: { index: number; reason: InterpretationRejectReason }[] } {
  const dropped: { index: number; reason: InterpretationRejectReason }[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { value, dropped };
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if ("confidence" in out) {
    const c = typeof out.confidence === "string" ? out.confidence.trim().toLowerCase() : undefined;
    if (c !== undefined && (CONFIDENCES as readonly string[]).includes(c)) out.confidence = c;
    else delete out.confidence;
  }
  if (Array.isArray(out.behaviours)) {
    const kept: unknown[] = [];
    out.behaviours.forEach((item, index) => {
      const ok = interpretedBehaviourSchema.safeParse(withoutBlankFields(item));
      if (!ok.success || kept.length >= MAX_BEHAVIOURS) return void dropped.push({ index, reason: "interpretation-schema" });
      kept.push(ok.data);
    });
    out.behaviours = kept;
  }
  if (Array.isArray(out.unsupported)) {
    const kept: unknown[] = [];
    out.unsupported.forEach((item, index) => {
      const ok = unsupportedEntrySchema.safeParse(item);
      if (!ok.success || kept.length >= MAX_UNSUPPORTED) return void dropped.push({ index: 1000 + index, reason: "interpretation-schema" });
      kept.push(ok.data);
    });
    out.unsupported = kept;
  }
  return { value: out, dropped };
}

const NAME_CHARSET = /^[\p{L}\p{N} _.&'-]+$/u;

function paramProblem(b: InterpretedBehaviour): InterpretationRejectReason | null {
  switch (b.kind) {
    case "scroll_depth":
      if (b.depthPercent === undefined || b.target !== undefined || b.heading !== undefined) return "interpretation-kind-param";
      break;
    case "click":
      if (b.depthPercent !== undefined) return "interpretation-kind-param";
      if (b.target === undefined || b.target.trim().length === 0) return "interpretation-kind-param";
      break;
    default:
      if (b.depthPercent !== undefined) return "interpretation-kind-param";
      break;
  }
  if (b.heading !== undefined && b.target === undefined) return "interpretation-kind-param";
  for (const v of [b.target, b.heading]) if (v !== undefined && !NAME_CHARSET.test(v)) return "interpretation-charset";
  return null;
}

/** The model's text with every behaviour that does not hold up removed (and reported); an unreadable whole is rejected. */
export function validateInterpretation(
  raw: unknown,
  request: string,
  inputPages: string[] = [],
  /**
   * Names the merchant CHOSE from a list we showed them (pick-one answers): by behaviour index, the exact values that were offered.
   * They come from the page, not from the merchant's words, so they are exempt from the "made of the merchant's own words" check.
   */
  offered: ReadonlyMap<number, ReadonlySet<string>> = new Map(),
): ValidateInterpretationResult {
  let jsonText: string;
  try {
    jsonText = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    return { ok: false, reason: "interpretation-schema", detail: "not JSON" };
  }
  if (jsonText === undefined || Buffer.byteLength(jsonText, "utf8") > MAX_INTERPRETATION_BYTES) return { ok: false, reason: "interpretation-bytes" };
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "interpretation-schema", detail: "not JSON" };
    }
  }
  const salvaged = salvageAnswer(value);
  const parsed = modelInterpretationSchema.safeParse(salvaged.value);
  if (!parsed.success) return { ok: false, reason: "interpretation-schema", detail: parsed.error.message.slice(0, 300) };
  const interpretation = structuredClone(parsed.data);

  const dropped: { index: number; reason: InterpretationRejectReason }[] = [...salvaged.dropped];
  const kept: InterpretedBehaviour[] = [];
  const normPages = inputPages.map(normalizeRequestText);
  interpretation.behaviours.forEach((b, index) => {
    const problem = paramProblem(b);
    if (problem) return void dropped.push({ index, reason: problem });
    if (!evidenceInRequest(b.evidence, request)) return void dropped.push({ index, reason: "interpretation-evidence" });
    if (b.kind === "click") {
      const reason = notAClickReason(b.evidence, b.target, b.heading);
      if (reason) {
        if (interpretation.unsupported.length < MAX_UNSUPPORTED) interpretation.unsupported.push({ evidence: b.evidence, reason });
        return void dropped.push({ index, reason: "interpretation-kind-param" });
      }
    }
    const own = (v: string | undefined) => v === undefined || offered.get(index)?.has(v) === true || targetTokensSubsetOfRequest(v, request);
    if (!own(b.target) || !own(b.heading)) {
      return void dropped.push({ index, reason: "interpretation-target-tokens" });
    }
    // Hints from older clients (event-name hints, counts, ordinals, free text) are discarded: event names are always built by code from
    // the page, and nothing else in the interpretation reaches the script.
    const { nameHint: _n, text: _t, ordinals: _o, unique: _u, ...clean } = b;
    if (clean.scopePaths?.length) clean.scopePaths = clean.scopePaths.filter((p) => normPages.includes(normalizeRequestText(p)));
    kept.push(clean);
  });
  interpretation.behaviours = kept;
  // Say so in the answer itself (fixed wording is shown for "unreadable"), so the confirmation screen can tell the merchant.
  if (salvaged.dropped.length > 0 && interpretation.unsupported.length < MAX_UNSUPPORTED && !interpretation.unsupported.some((u) => u.reason === "unreadable")) {
    interpretation.unsupported.push({ evidence: "part of the answer", reason: "unreadable" });
  }
  // `unsupported` entries are kept as they are: their text is never shown, and a made-up one can only make the build stricter.
  return { ok: true, interpretation, dropped };
}

export function parseInterpretationJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
