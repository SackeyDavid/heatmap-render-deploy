import { AGENT_QUESTION_CODE } from "./errors.ts";
import type { JobFailure } from "./types.ts";

/** A merchant-facing question is never longer than this. */
export const MAX_QUESTION_CHARS = 300;
/** The internal failure reason kept in the job record is capped at this. */
export const MAX_FAILURE_REASON_CHARS = 500;

// Control, bidi, zero-width, line/paragraph separator and BOM characters, and angle brackets.
const UNSAFE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff<>]", "g");

/**
 * Plain text only: control, bidi, zero-width and BOM characters and angle brackets removed, whitespace collapsed, capped.
 * The one place a question is cleaned; the job record, the HTTP answer and the email all see this text.
 */
export function sanitizeQuestion(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw
    .slice(0, 2000)
    .replace(UNSAFE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length === 0) return undefined;
  return t.length > MAX_QUESTION_CHARS ? `${t.slice(0, MAX_QUESTION_CHARS - 3).trimEnd()}...` : t;
}

/** Cuts an internal reason to a bounded length (it stays internal; it is never put into a message to the merchant). */
export function boundReason(s: string): string {
  return s.length > MAX_FAILURE_REASON_CHARS ? `${s.slice(0, MAX_FAILURE_REASON_CHARS - 3)}...` : s;
}

/**
 * The "what happened" text for a failure email: always a fixed sentence, so builder output, agent stderr or server paths in
 * `reason` can never reach a mailbox. For an agent question the email then carries only the sanitised, bounded `question`.
 */
export function failureEmailDetail(f: JobFailure | undefined): string {
  if (f?.code === AGENT_QUESTION_CODE && f.question) return "Your request needs one more detail from you (below).";
  return "The step that builds your script did not finish. We have logged the details.";
}
