import { z } from "zod";

/**
 * The INTERPRETATION: the one structured thing a MODEL produces from the merchant's description (the in-browser helper, or the
 * Claude agent on the server). Everything after it is deterministic code that VALIDATES it against the real page and RENDERS the
 * script. No code in the production path reads the merchant's prose to work out what to track.
 *
 * Shape (schemaVersion 1):
 *   behaviours   what to track: click targets exactly as the merchant named them (+ an optional heading qualifier),
 *                scroll depths, FAQ opens. Other kinds are accepted only so they can be reported as "not tracked".
 *   unsupported  what the merchant asked for that cannot be tracked, each with a reason code (fixed wording is shown, never the
 *                model's text).
 *   confidence   the model's own estimate; low confidence changes how the confirmation is worded, never whether there is one.
 */

/** Matches HTTP `pageUrls` / `savedPages` cap (see `src/entrypoints/http/validate.ts`). */
export const MAX_SCOPE_PATHS = 10;

export const TRIGGER_KINDS = [
  "click",
  "scroll_depth",
  "faq_open",
  "form_start",
  "form_submit",
  "form_abandon",
  "video_play",
  "tab_switch",
] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const triggerKindSchema = z.enum(TRIGGER_KINDS);

/** Why a part of the request is not tracked. Every code has fixed merchant-facing wording (see not-tracked.ts). */
export const UNSUPPORTED_REASONS = [
  "exclusion", // "everything except X", "don't track X": the builder only knows what to include (blocks the build)
  "own_event_name",
  "count",
  "condition",
  "page_limit",
  "visitor_filter",
  "first_time",
  "faq_specific",
  "faq_close",
  "hover",
  "keyboard",
  "window_change",
  "leaving_page",
  "double_click",
  "long_press",
  "tab_switch",
  "video_play",
  "form_activity",
  "cart",
  "time_delay",
  "time_on_page",
  "page_view",
  "typing",
  "visitor_details",
  "scroll_other",
  "other_language",
  "unreadable",
  "not_understood",
  "in_view",
  "value_capture",
  "other_site",
  "not_an_action",
  "other",
] as const;

export type UnsupportedReason = (typeof UNSUPPORTED_REASONS)[number];

export const unsupportedReasonSchema = z.enum(UNSUPPORTED_REASONS);

export const CONFIDENCES = ["high", "medium", "low"] as const;
export const confidenceSchema = z.enum(CONFIDENCES);

export const uniqueKindSchema = z.enum(["element", "label", "none"]);

const phraseCharset = /^[\p{L}\p{N} _.&'-]+$/u;
const textCharset = /^[\p{L}\p{N} _.&-]+$/u;
const nameHintPattern = /^[a-z][a-z0-9_]*$/;

export const MAX_BEHAVIOURS = 30;
export const MAX_UNSUPPORTED = 20;
/** Largest interpretation (as JSON) accepted from a model or a client. */
export const MAX_INTERPRETATION_BYTES = 16000;

export const interpretedBehaviourSchema = z
  .object({
    kind: triggerKindSchema,
    /** Words copied from the merchant's request; must occur in it (checked in validate.ts). */
    evidence: z.string().max(160),
    /** A button or link as the merchant NAMED it. Matched to the real page by match-controls.ts; never used in code. */
    target: z.string().max(80).regex(phraseCharset).optional(),
    /** Optional qualifier: the heading the target sits under ("Learn More" under "Fitness for Everyone"). */
    heading: z.string().max(80).regex(phraseCharset).optional(),
    /** True only when the merchant named a text field / box ("the search box"). */
    field: z.boolean().optional(),
    /** Scroll depth in percent as the merchant meant it. Only 25, 50, 75, 90 and 100 can be built; others are reported. */
    depthPercent: z.number().finite().min(-1000).max(1000).optional(),
    // Legacy hints from schema 1 clients. Accepted and sanitised, never used by the builder (event names are always built by code).
    ordinals: z.array(z.number().int().min(1).max(20)).max(10).optional(),
    unique: uniqueKindSchema.optional(),
    text: z.string().max(80).regex(textCharset).optional(),
    nameHint: z.string().max(80).regex(nameHintPattern).optional(),
    scopePaths: z.array(z.string().max(200)).max(MAX_SCOPE_PATHS).optional(),
  })
  .strict();

export const unsupportedEntrySchema = z
  .object({
    evidence: z.string().max(160),
    reason: unsupportedReasonSchema,
  })
  .strict();

export const modelInterpretationSchema = z
  .object({
    schemaVersion: z.literal(1),
    promptVersion: z.string().max(24),
    modelId: z.string().max(80),
    confidence: confidenceSchema.optional(),
    behaviours: z.array(interpretedBehaviourSchema).max(MAX_BEHAVIOURS),
    unsupported: z.array(unsupportedEntrySchema).max(MAX_UNSUPPORTED),
  })
  .strict();

export type InterpretedBehaviour = z.infer<typeof interpretedBehaviourSchema>;
export type UnsupportedEntry = z.infer<typeof unsupportedEntrySchema>;
export type ModelInterpretation = z.infer<typeof modelInterpretationSchema>;
