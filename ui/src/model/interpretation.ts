/** Browser-side strict parse (parity with server zod; no import from src/). */
import { LIMITS } from "../api/contract";
import schemaJson from "./interpretation.schema.json";

export type TriggerKind =
  | "click"
  | "scroll_depth"
  | "faq_open"
  | "form_start"
  | "form_submit"
  | "form_abandon"
  | "video_play"
  | "tab_switch";

export type InterpretedBehaviour = {
  kind: TriggerKind;
  evidence: string;
  /** A button or link as the merchant named it. */
  target?: string;
  /** Optional qualifier: the heading the target sits under. */
  heading?: string;
  /** True only when the merchant named a text field / box. */
  field?: boolean;
  /** Scroll depth in percent as the merchant meant it (only 25, 50, 75, 90, 100 can be built). */
  depthPercent?: number;
  scopePaths?: string[];
};

export type ModelInterpretation = {
  schemaVersion: 1;
  promptVersion: string;
  modelId: string;
  confidence?: "high" | "medium" | "low";
  behaviours: InterpretedBehaviour[];
  unsupported: { evidence: string; reason: string }[];
};

export const MAX_BEHAVIOURS = 30;
export const MAX_UNSUPPORTED = 20;

const KINDS = new Set<string>([
  "click",
  "scroll_depth",
  "faq_open",
  "form_start",
  "form_submit",
  "form_abandon",
  "video_play",
  "tab_switch",
]);

const PHRASE_CHARSET = /^[\p{L}\p{N} _.&'-]+$/u;
const CONFIDENCES = new Set(["high", "medium", "low"]);
/** Same list as the server (UNSUPPORTED_REASONS in src/operations/klaviyo-segmentation/interpretation/schema.ts); a test pins them together. */
export const UNSUPPORTED_REASONS = [
  "exclusion", "own_event_name", "count", "condition", "page_limit", "visitor_filter", "first_time", "faq_specific", "faq_close",
  "hover", "keyboard", "window_change", "leaving_page", "double_click", "long_press", "tab_switch", "video_play", "form_activity",
  "cart", "time_delay", "time_on_page", "page_view", "typing", "visitor_details", "scroll_other", "other_language", "unreadable",
  "not_understood", "in_view", "value_capture", "other_site", "not_an_action", "other",
] as const;
const UNSUPPORTED_REASON_SET = new Set<string>(UNSUPPORTED_REASONS);

/**
 * One bad field must not discard a whole answer (parity with salvageAnswer in the server's validate.ts): the confidence is lower-cased
 * (anything else is left out), every behaviour and every "not supported" entry is checked on its own and the ones that do not fit are
 * dropped and counted, and behaviours beyond the cap are dropped. What is left still goes through the strict parse.
 */
/** A small model often writes an unused optional field as "" (for example "heading":""); that means "not given". */
function withoutBlankFields(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, v]) => !(typeof v === "string" && v.trim() === "")));
}

export function salvageAnswer(value: unknown): { value: unknown; droppedItems: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, droppedItems: 0 };
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  let droppedItems = 0;
  if ("confidence" in out) {
    const c = typeof out.confidence === "string" ? out.confidence.trim().toLowerCase() : undefined;
    if (c !== undefined && CONFIDENCES.has(c)) out.confidence = c;
    else delete out.confidence;
  }
  if (Array.isArray(out.behaviours)) {
    const kept: InterpretedBehaviour[] = [];
    for (const item of out.behaviours) {
      const parsed = kept.length < MAX_BEHAVIOURS ? parseBehaviour(withoutBlankFields(item)) : null;
      if (parsed) kept.push(parsed);
      else droppedItems++;
    }
    out.behaviours = kept;
  }
  if (Array.isArray(out.unsupported)) {
    const kept: ModelInterpretation["unsupported"] = [];
    for (const item of out.unsupported) {
      const parsed = kept.length < MAX_UNSUPPORTED ? parseUnsupported(item) : null;
      if (parsed) kept.push(parsed);
      else droppedItems++;
    }
    out.unsupported = kept;
  }
  return { value: out, droppedItems };
}

export function parseModelInterpretation(raw: unknown): ModelInterpretation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  if (typeof o.promptVersion !== "string" || o.promptVersion.length > 24) return null;
  if (typeof o.modelId !== "string" || o.modelId.length > 80) return null;
  if (!Array.isArray(o.behaviours) || o.behaviours.length > MAX_BEHAVIOURS) return null;
  if (!Array.isArray(o.unsupported) || o.unsupported.length > MAX_UNSUPPORTED) return null;
  for (const key of Object.keys(o)) {
    if (!["schemaVersion", "promptVersion", "modelId", "confidence", "behaviours", "unsupported"].includes(key)) return null;
  }
  if (o.confidence !== undefined && (typeof o.confidence !== "string" || !CONFIDENCES.has(o.confidence))) return null;
  const behaviours: InterpretedBehaviour[] = [];
  for (const b of o.behaviours) {
    const parsed = parseBehaviour(b);
    if (!parsed) return null;
    behaviours.push(parsed);
  }
  const unsupported: ModelInterpretation["unsupported"] = [];
  for (const u of o.unsupported) {
    const parsed = parseUnsupported(u);
    if (!parsed) return null;
    unsupported.push(parsed);
  }
  return {
    schemaVersion: 1,
    promptVersion: o.promptVersion,
    modelId: o.modelId,
    ...(o.confidence !== undefined ? { confidence: o.confidence as ModelInterpretation["confidence"] } : {}),
    behaviours,
    unsupported,
  };
}

function parseUnsupported(raw: unknown): ModelInterpretation["unsupported"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.evidence !== "string" || u.evidence.length > 160) return null;
  if (typeof u.reason !== "string" || !UNSUPPORTED_REASON_SET.has(u.reason)) return null;
  for (const key of Object.keys(u)) {
    if (!["evidence", "reason"].includes(key)) return null;
  }
  return { evidence: u.evidence, reason: u.reason };
}

function parseBehaviour(raw: unknown): InterpretedBehaviour | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.kind !== "string" || !KINDS.has(b.kind)) return null;
  if (typeof b.evidence !== "string" || b.evidence.length > 160) return null;
  const allowed = ["kind", "evidence", "target", "heading", "field", "depthPercent", "scopePaths"];
  for (const key of Object.keys(b)) {
    if (!allowed.includes(key)) return null;
  }
  for (const key of ["target", "heading"] as const) {
    const v = b[key];
    if (v !== undefined && (typeof v !== "string" || v.length > 80 || !PHRASE_CHARSET.test(v))) return null;
  }
  if (b.field !== undefined && typeof b.field !== "boolean") return null;
  if (b.depthPercent !== undefined) {
    if (typeof b.depthPercent !== "number" || !Number.isFinite(b.depthPercent) || Math.abs(b.depthPercent) > 1000) return null;
  }
  if (b.scopePaths !== undefined) {
    if (!Array.isArray(b.scopePaths) || b.scopePaths.length > LIMITS.pages) return null;
    for (const p of b.scopePaths) {
      if (typeof p !== "string" || p.length > 200) return null;
    }
  }
  return {
    kind: b.kind as TriggerKind,
    evidence: b.evidence,
    ...(b.target !== undefined ? { target: b.target as string } : {}),
    ...(b.heading !== undefined ? { heading: b.heading as string } : {}),
    ...(b.field !== undefined ? { field: b.field as boolean } : {}),
    ...(b.depthPercent !== undefined ? { depthPercent: b.depthPercent as number } : {}),
    ...(b.scopePaths !== undefined ? { scopePaths: b.scopePaths as string[] } : {}),
  };
}

export function extractJsonObjectFromText(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    /* fall through */
  }
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export const interpretationJsonSchemaString = JSON.stringify(schemaJson);
