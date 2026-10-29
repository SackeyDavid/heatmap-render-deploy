// Merchant-safe wording. Nothing here ever echoes internal rule text or failure reasons. The ONE exception is a failure at the
// generate step whose `question` was set by the agent itself (code "agent-question": the rule-table builder's refusal, made of
// fixed templates and sanitised page labels, never the merchant's own words). It is re-bounded here and shown as plain text.
import { AGENT_QUESTION_CODE, READER_UNAVAILABLE_CODE } from "../../domain/errors.ts";
import { MAX_QUESTION_CHARS, sanitizeQuestion } from "../../domain/safe-question.ts";
import { stepKind } from "../../domain/step-id.ts";
import type { Job, JobFailure } from "../../domain/types.ts";
import type { OperationRequestMapper } from "../../ports/index.ts";
import type { FailedCode, Post400Code } from "./codes.ts";

/**
 * What a request is doing, for the requester:
 *   queued -> interpreting -> needs-confirmation -> (approve) -> running -> succeeded | failed.
 * "interpreting": we are reading the request and checking it against your page. "needs-confirmation": we understood it and are
 * waiting for you to approve what we understood. "running": approved, the script is being generated and checked.
 */
export type PublicStatus = "queued" | "interpreting" | "needs-confirmation" | "running" | "succeeded" | "failed";

import { PLAIN } from "../../domain/plain-messages.ts";

export const MSG = {
  unauthorized: "Please sign in again to continue. Your session may have expired.",
  wrongEnvironment: "This sign-in belongs to a different environment. Please sign in again.",
  notFound: "We couldn't find that request.",
  routeNotFound: "That page doesn't exist.",
  methodNotAllowed: "That action isn't supported here.",
  tooLarge: "That's more than we can take in one go. Try sending fewer or smaller saved pages.",
  notJson: "We couldn't read that request. Please try again from the form.",
  badJson: "We couldn't read that request. Please try again from the form.",
  rateLimited: "You're sending requests quickly. Please wait a minute and try again.",
  tooManyOpen: "You already have several requests in progress. Please wait for one to finish, then try again.",
  needEmail: "Please tell us which email address to send the result to.",
  internal: "Something went wrong on our side. Please try again in a few minutes.",
  generic: PLAIN.generic,
  prompt: PLAIN.prompt,
  pageUrls: "Please add between 1 and 10 page addresses that start with http:// or https://.",
  pageUrlLong: "One of the page addresses is too long. Please use a shorter address.",
  savedPages: "We couldn't use one of the saved pages. Please check each has an address and some page content.",
  savedPageTooLarge: "One of the saved pages is too large. Please save a smaller page.",
  email: PLAIN.email,
  notAwaiting: "That request is not waiting for your approval any more.",
  approval: "We couldn't use that approval. Please look at what we understood and approve it again.",
} as const;

const STATUS_MESSAGES: Record<Exclude<PublicStatus, "failed">, string> = {
  queued: "We've received your request and will start on it shortly.",
  interpreting: "We're reading your request and checking it against your page.",
  "needs-confirmation": "Here is what we understood. Please check it and approve it, or change your request. Nothing is built until you approve.",
  running: "We're working on your tracking script. This usually takes a few minutes.",
  succeeded: "Your tracking script is ready. Use the test tags below to check that it works.",
};

/** Longest agent question shown. */
export const MAX_AGENT_QUESTION_CHARS = MAX_QUESTION_CHARS;

/** Plain text only: control characters and angle brackets removed, whitespace collapsed, capped. Undefined when nothing is left. */
export function agentQuestionText(failure: JobFailure | undefined): string | undefined {
  if (!failure || (failure.code !== AGENT_QUESTION_CODE && failure.code !== READER_UNAVAILABLE_CODE) || !["generate", "confirm"].includes(stepKind(failure.step)) || typeof failure.question !== "string") return undefined;
  return sanitizeQuestion(failure.question);
}

/** The step is "validate" or "<index>:<kind>"; anything unrecognised gets the generic text. */
export function failureMessage(failure: JobFailure | undefined, mapper?: Pick<OperationRequestMapper, "failureMessage">): string {
  const step = failure?.step ?? "";
  const kind = stepKind(step);
  const own = mapper?.failureMessage?.(kind, failure?.code);
  if (own) return own;
  switch (kind) {
    case "validate":
      return "We couldn't confirm that your site is ready for this yet. Please check the setup, then try again. Nothing was changed on your site.";
    case "inspect":
      return "We couldn't open one of your pages. Please make sure each page is public and the address is right, then try again. If it still doesn't open, you can paste a saved copy of the page under \"More options\" on the form. Nothing was changed on your site.";
    case "confirm":
      return agentQuestionText(failure) ?? "We couldn't work out what to track from your description. Try describing the button or part of your page in a different way. Nothing was changed on your site.";
    case "generate":
      return agentQuestionText(failure) ?? "We couldn't build the tracking script from your description. Try describing the button or part of your page in a different way. Nothing was changed on your site.";
    case "qa":
      return "We built a script, but it didn't pass our automatic checks, so we didn't turn it on. Try describing what you want to track in simpler terms. Nothing was changed on your site.";
    case "publish":
      return "We couldn't save your script. Please try again in a few minutes. Nothing was changed on your site.";
    case "verify":
      return "We couldn't confirm the script works, so we didn't turn it on. Please try again. Nothing was changed on your site.";
    case "notify":
      return "Your script is ready, but we couldn't send the confirmation email. You can still use the test tags shown here.";
    default:
      return "We couldn't finish your request. Nothing was changed on your site. Please try again, or contact support if it keeps happening.";
  }
}

export function statusMessage(status: PublicStatus, job: Job | null, mapper?: Pick<OperationRequestMapper, "failureMessage">): string {
  return status === "failed" ? failureMessage(job?.failure, mapper) : STATUS_MESSAGES[status];
}

/** Stable code for a failed job, from the step that failed. Unknown steps are "internal". */
export function failureCode(failure: JobFailure | undefined): FailedCode {
  const step = failure?.step ?? "";
  const kind = stepKind(step);
  switch (kind) {
    case "validate":
      return "validate-failed";
    case "inspect":
      return "inspect-failed";
    case "confirm":
      return failure?.code === READER_UNAVAILABLE_CODE ? "reader-unavailable" : "confirm-failed";
    case "generate":
      return "generate-failed";
    case "qa":
      return "qa-failed";
    case "publish":
      return "publish-failed";
    case "verify":
      return "verify-failed";
    case "notify":
      return "notify-failed";
    default:
      return "internal";
  }
}
