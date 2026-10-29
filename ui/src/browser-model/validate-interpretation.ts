import type { InterpretedBehaviour, ModelInterpretation } from "../model/interpretation";
import { MAX_UNSUPPORTED, parseModelInterpretation, salvageAnswer } from "../model/interpretation";
import { evidenceInRequest, normalizeRequestText, targetTokensSubsetOfRequest } from "./text-utils";

/**
 * Parity with the server's validate.ts (src/operations/klaviyo-segmentation/interpretation/validate.ts): shape, size, character sets,
 * evidence quoted from the request, names made of the merchant's own words. Not language understanding: the model does that; the server
 * checks the answer again against the real page.
 */
export type InterpretationRejectReason =
  | "interpretation-bytes"
  | "interpretation-schema"
  | "interpretation-evidence"
  | "interpretation-target-tokens"
  | "interpretation-kind-param"
  | "interpretation-charset";

export const MAX_INTERPRETATION_BYTES = 16000;

export type ValidatedBehaviour = InterpretedBehaviour & { valid: true };

export type ValidateInterpretationResult =
  | {
      ok: true;
      interpretation: ModelInterpretation;
      behaviours: ValidatedBehaviour[];
      dropped: { index: number; reason: InterpretationRejectReason }[];
    }
  | { ok: false; reason: InterpretationRejectReason; detail?: string };

/** A model sometimes files "hovers over X" or "types in X" as a click. The merchant's own quoted words settle it (parity with the server). */
const NOT_A_CLICK: { pattern: RegExp; reason: "hover" | "typing" }[] = [
  { pattern: /\b(hover(s|ed|ing)?|mouse(s|d)?\s+over|rolls?\s+over)\b/i, reason: "hover" },
  { pattern: /\b(types?|typed|typing)\b/i, reason: "typing" },
];

/** The text without the LAST whole-word occurrence of `name` (the name normally comes after the verb, so a verb that repeats the name's word stays). */
function withoutLastOccurrence(text: string, name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const all = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"))];
  const last = all[all.length - 1];
  if (!last || last.index === undefined) return text;
  return `${text.slice(0, last.index)} ${text.slice(last.index + last[0].length)}`;
}

/** Which "not a click" reason applies to the words AROUND the control's name, if any (parity with the server's not-a-click.ts). */
function notAClickReason(evidence: string, target: string | undefined, heading: string | undefined): "hover" | "typing" | undefined {
  const rest = withoutLastOccurrence(withoutLastOccurrence(evidence, target), heading);
  return NOT_A_CLICK.find((n) => n.pattern.test(rest))?.reason;
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

/** Fast reject in the browser before the interpretation is sent to the server. */
export function validateInterpretation(raw: unknown, request: string, inputPages: string[]): ValidateInterpretationResult {
  const jsonText = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (jsonText === undefined || new TextEncoder().encode(jsonText).length > MAX_INTERPRETATION_BYTES) {
    return { ok: false, reason: "interpretation-bytes" };
  }
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "interpretation-schema" };
    }
  }
  const salvaged = salvageAnswer(value);
  const parsed = parseModelInterpretation(salvaged.value);
  if (!parsed) return { ok: false, reason: "interpretation-schema" };
  const interpretation: ModelInterpretation = { ...parsed };

  const dropped: { index: number; reason: InterpretationRejectReason }[] = Array.from({ length: salvaged.droppedItems }, (_, i) => ({ index: i, reason: "interpretation-schema" as const }));
  const behaviours: ValidatedBehaviour[] = [];
  const normPages = inputPages.map(normalizeRequestText);
  interpretation.behaviours.forEach((b, index) => {
    const problem = paramProblem(b);
    if (problem) return void dropped.push({ index, reason: problem });
    if (!evidenceInRequest(b.evidence, request)) return void dropped.push({ index, reason: "interpretation-evidence" });
    if (b.kind === "click") {
      const reason = notAClickReason(b.evidence, b.target, b.heading);
      if (reason) {
        if (interpretation.unsupported.length < MAX_UNSUPPORTED) interpretation.unsupported = [...interpretation.unsupported, { evidence: b.evidence, reason }];
        return void dropped.push({ index, reason: "interpretation-kind-param" });
      }
    }
    if (!targetTokensSubsetOfRequest(b.target, request) || !targetTokensSubsetOfRequest(b.heading, request)) {
      return void dropped.push({ index, reason: "interpretation-target-tokens" });
    }
    const scopePaths = b.scopePaths?.length ? b.scopePaths.filter((p) => normPages.includes(normalizeRequestText(p))) : b.scopePaths;
    behaviours.push({ ...b, ...(scopePaths ? { scopePaths } : {}), valid: true });
  });
  interpretation.behaviours = behaviours.map(({ valid: _v, ...rest }) => rest);
  // Say so in the answer itself (the server shows fixed wording for "unreadable"), so the confirmation can tell the merchant.
  if (salvaged.droppedItems > 0 && interpretation.unsupported.length < MAX_UNSUPPORTED && !interpretation.unsupported.some((u) => u.reason === "unreadable")) {
    interpretation.unsupported = [...interpretation.unsupported, { evidence: "part of the answer", reason: "unreadable" }];
  }
  return { ok: true, interpretation, behaviours, dropped };
}
