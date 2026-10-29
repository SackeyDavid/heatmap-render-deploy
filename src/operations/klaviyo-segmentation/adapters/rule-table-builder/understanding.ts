import { createHash } from "node:crypto";
import { AGENT_QUESTION_CODE, READER_UNAVAILABLE_CODE, StepFailure } from "../../../../domain/errors.ts";
import { sanitizeQuestion } from "../../../../domain/safe-question.ts";
import type { Confirmation, PageSnapshot } from "../../../../domain/types.ts";
import type { ConfirmOutcome } from "../../../../ports/index.ts";
import type { KlaviyoConfirmArgs } from "../../ports.ts";
import { choiceMessage, choiceQuestion, planProblem } from "./build.ts";
import type { EventPlan } from "./event-plan.ts";
import { planFromInterpretation } from "./interpretation-plan.ts";
import type { PageControls } from "./match-controls.ts";
import { boundQuestion } from "./safe-text.ts";
import type { ModelInterpretation } from "../../interpretation/schema.ts";
import { interpretationFromUnknown } from "../../interpretation/from-unknown.ts";
import { validateInterpretation } from "../../interpretation/validate.ts";

/**
 * "Here is what we understood": the data behind the confirmation screen. Built only from the checked interpretation and the real
 * page (never from the merchant's words), so everything in it is either fixed wording or a page label reduced to a safe character set.
 */
export interface Understanding {
  version: 1;
  /** The model's own estimate, lowered when parts of its answer were discarded. */
  confidence: "high" | "medium" | "low";
  /** True whenever the merchant should look closely: not high confidence, a question, or something that will not be tracked. */
  needsAttention: boolean;
  tracked: { index: number; kind: "click" | "scroll" | "faq"; title: string; event: string; control?: string; /** The merchant's own words this came from (short, plain text; shown quoted so a misreading such as a negation is visible). */ words?: string }[];
  /** Plain sentences: what will NOT be tracked, and why. */
  notTracked: string[];
  /** Pick-one questions. The approval cannot be sent until each has an answer applied to the interpretation. */
  questions: UnderstandingQuestion[];
  /** Notes about what was built (for example two same-named links tracked as one event). */
  notes: string[];
}

export interface UnderstandingQuestion {
  id: string;
  prompt: string;
  /** Each option says how to change the behaviour at `behaviourIndex` when chosen. */
  behaviourIndex: number;
  options: { id: string; label: string; set: { target?: string; heading?: string } }[];
}

/** Hash of the controls the page offered; changes when the page's buttons, links or headings change. */
export function fingerprintPages(snapshots: Pick<PageSnapshot, "url" | "controls" | "hiddenControls">[]): string {
  const stable = snapshots.map((s) => ({ url: s.url, controls: s.controls, hidden: s.hiddenControls ?? [] }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export const pagesOf = (snapshots: PageSnapshot[]): PageControls[] =>
  snapshots.map((s) => ({ url: s.url, controls: s.controls, ...(s.hiddenControls?.length ? { hiddenControls: s.hiddenControls } : {}) }));

const sentence = (s: string): string => {
  const t = sanitizeQuestion(s) ?? "";
  return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

/** A page label as a name value the interpretation schema accepts (the same words once punctuation is ignored, which is how names are matched). */
const asName = (label: string): string => label.replace(/[^\p{L}\p{N} _.&'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export function buildUnderstanding(interpretation: ModelInterpretation, plan: EventPlan, dropped: number): Understanding {
  const model = interpretation.confidence ?? "medium";
  const confidence: Understanding["confidence"] = dropped > 1 ? "low" : dropped > 0 && model === "high" ? "medium" : model;
  const tracked: Understanding["tracked"] = [];
  // The merchant's own words for each item (the evidence the model quoted; it was checked to occur in the request).
  const wordsOf = (index: number): { words?: string } => {
    const w = sanitizeQuestion(interpretation.behaviours[index]?.evidence ?? "");
    return w ? { words: w.length > 90 ? `${w.slice(0, 87).trimEnd()}...` : w } : {};
  };
  for (const t of plan.trace) {
    if (t.outcome !== "built") continue;
    if (t.kind === "click") {
      // The page's own label (link "Search"), not the model's lowercase target.
      const label = boundQuestion(t.label || t.target);
      const heading = t.labelHeading ?? t.heading;
      tracked.push({ index: t.index, kind: "click", title: `When a visitor clicks ${heading ? `"${label}" under "${boundQuestion(heading)}"` : `"${label}"`}`, event: t.event, control: t.control, ...wordsOf(t.index) });
    } else if (t.kind === "faq") {
      tracked.push({ index: t.index, kind: "faq", title: "When a visitor opens an FAQ question", event: t.event, control: t.control, ...wordsOf(t.index) });
    } else if (t.kind === "scroll") {
      tracked.push({ index: t.index, kind: "scroll", title: `When a visitor scrolls ${t.percent}% of the way down the page`, event: t.event, ...wordsOf(t.index) });
    }
  }
  // In the order the model read them from the merchant's words (the plan builds scrolls and clicks in separate passes).
  tracked.sort((x, y) => x.index - y.index);
  const questions: UnderstandingQuestion[] = plan.choices.map((c, i) => ({
    id: `q${i + 1}`,
    prompt: boundQuestion(choiceMessage(c).replace(/ Say which one.*$/, " Which one do you mean?")),
    behaviourIndex: c.behaviourIndex,
    options: c.options.slice(0, 12).map((label, k) => ({
      id: `o${k + 1}`,
      label: boundQuestion(label),
      set: c.kind === "label" ? { heading: asName(label) } : { target: asName(label), heading: asName(c.name) },
    })),
  }));
  const notTracked = plan.notTracked.map(sentence).filter((s) => s.length > 0);
  return {
    version: 1,
    confidence,
    needsAttention: confidence !== "high" || questions.length > 0 || notTracked.length > 0,
    tracked,
    notTracked,
    questions,
    notes: plan.notes.map(sentence).filter((s) => s.length > 0),
  };
}


const same = (a: string | undefined, b: string | undefined): boolean => (a ?? "").trim().replace(/\s+/g, " ").toLowerCase() === (b ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The approval must be what the merchant was shown. Every approved behaviour has to match one the merchant saw (same kind, same target,
 * heading, field flag and depth), except that a pick-one answer may choose among the page labels the question listed for that
 * behaviour, and nothing else. Fewer behaviours than were shown is fine (the merchant dropped some); more, or anything new, is not.
 * Returns the reason it does not match, or undefined when it does.
 */
function approvalMismatch(approved: ModelInterpretation, shown: ModelInterpretation, offered: ReadonlyMap<number, ReadonlySet<string>>): string | undefined {
  if (approved.behaviours.length > shown.behaviours.length) return `the approval has ${approved.behaviours.length} behaviours, ${shown.behaviours.length} were shown`;
  for (const [i, a] of approved.behaviours.entries()) {
    const ok = shown.behaviours.some((p, j) => {
      if (p.kind !== a.kind || (p.depthPercent ?? null) !== (a.depthPercent ?? null)) return false;
      if ((p.field === true) !== (a.field === true)) return false;
      const picks = [...(offered.get(j) ?? [])];
      const value = (shownValue: string | undefined, approvedValue: string | undefined) => same(shownValue, approvedValue) || (approvedValue !== undefined && picks.some((o) => same(o, approvedValue)));
      return value(p.target, a.target) && value(p.heading, a.heading);
    });
    if (!ok) return `approved behaviour ${i + 1} (${a.kind}) was not among the ones shown`;
  }
  return undefined;
}

const refuse = (error: string, question: string): never => {
  throw new StepFailure(error, question, AGENT_QUESTION_CODE);
};
/** The server-side reader's answer could not be used: its own failure code, so a client may read the words itself and send them again. */
const readerFailed = (error: string, question: string): never => {
  throw new StepFailure(error, question, READER_UNAVAILABLE_CODE);
};

/**
 * The klaviyo operation's `confirm` step, pure. Inputs: the description (only to check that the model quoted it), the interpretation a
 * model produced (from the client, or from the server-side agent), the approval if one arrived, and the pages as they are now.
 *  - no interpretation: ask the pipeline to get one from the interpreter agent (needs-interpretation), or refuse;
 *  - an interpretation, no approval: check it against the page; refuse what cannot work; otherwise "needs-confirmation" with the summary;
 *  - an approval: check it again against the page as it is NOW and against what the merchant was shown; accept or refuse.
 */
export function confirmKlaviyo(args: KlaviyoConfirmArgs): ConfirmOutcome {
  const pages = pagesOf(args.snapshots);
  const fingerprint = fingerprintPages(args.snapshots);

  if (args.approval) {
    // Values the merchant picked from a pick-one list we showed come from the page, not from their words.
    const offered = new Map<number, Set<string>>();
    const shown = (args.previous?.summary as Understanding | undefined)?.questions ?? [];
    for (const q of Array.isArray(shown) ? shown : []) {
      const set = offered.get(q.behaviourIndex) ?? new Set<string>();
      for (const o of q.options) for (const v of [o.set.target, o.set.heading]) if (typeof v === "string") set.add(v);
      offered.set(q.behaviourIndex, set);
    }
    const checked = validateInterpretation(args.approval.interpretation, args.description, args.pageUrls, offered);
    if (!checked.ok) return refuse(`The approved interpretation was refused (${checked.reason}).`, "We could not use the approval we received. Please send your request again.");
    if (args.previous) {
      const shownInterpretation = interpretationFromUnknown(args.previous.proposed);
      const mismatch = shownInterpretation ? approvalMismatch(checked.interpretation, shownInterpretation, offered) : "what was shown cannot be read back";
      if (mismatch) return refuse(`The approval is not what the merchant was shown (${mismatch}).`, "What you approved is not what we showed you, so we did not build anything. Please send your request again and check what we understood.");
    }
    if (args.previous && args.previous.fingerprint !== fingerprint) {
      return refuse("The page changed between the request and its approval.", "The page changed after you looked at what we understood, so we did not build anything. Please send your request again.");
    }
    const plan = planFromInterpretation(checked.interpretation, pages, args.eventTag);
    if (plan.choices.length > 0 && !plan.refusal) return refuse(plan.choices.map((c) => choiceMessage(c)).join(" "), boundQuestion(choiceQuestion(plan.choices[0]!)));
    const problem = planProblem(plan, pages);
    if (problem) return refuse(problem.error, problem.question);
    return { kind: "approved", files: { "interpretation.json": `${JSON.stringify(checked.interpretation, null, 2)}\n`, "event-tag.txt": args.eventTag ?? "" } };
  }

  const raw = args.agentInterpretation ?? args.proposed;
  if (raw === undefined || raw === null) return { kind: "needs-interpretation", prompt: args.interpretPrompt(), ...(args.proposalUnreadable ? { unreadable: true } : {}) };
  const checked = validateInterpretation(raw, args.description, args.pageUrls);
  // Parts of the answer that did not fit the schema were dropped; if that was everything, nothing usable remains.
  const nothingUsable = checked.ok && checked.interpretation.behaviours.length === 0 && checked.dropped.some((d) => d.reason === "interpretation-schema");
  if (nothingUsable) {
    if (args.agentInterpretation !== undefined) return readerFailed("The interpreter's answer had nothing usable in it.", "Our assistant's answer could not be read. Please try again.");
    return { kind: "needs-interpretation", prompt: args.interpretPrompt(), unreadable: true };
  }
  if (!checked.ok) {
    // An answer from the agent that cannot be used is a refusal; a client's unusable proposal is treated as no proposal at all.
    if (args.agentInterpretation !== undefined) {
      return readerFailed(`The interpreter's answer was refused (${checked.reason}).`, "Our assistant could not read your request clearly enough to build from it. Please say it a different way, for example: \"Tell me when someone clicks Search\".");
    }
    return { kind: "needs-interpretation", prompt: args.interpretPrompt(), unreadable: true };
  }
  // The server-side reader quoted words the merchant never wrote and nothing else is left: its mistake, not a page problem.
  if (args.agentInterpretation !== undefined && checked.interpretation.behaviours.length === 0 && checked.dropped.some((d) => d.reason === "interpretation-evidence")) {
    return readerFailed("The interpreter's answer quoted words that are not in the request.", "Our assistant could not read your request clearly enough to build from it. Please say it a different way, for example: \"Tell me when someone clicks Search\".");
  }
  const plan = planFromInterpretation(checked.interpretation, pages, args.eventTag);
  // Choices are questions, not refusals; anything else that cannot work is refused now, before the merchant is asked to approve it.
  const problem = planProblem(plan, pages);
  if (problem) return refuse(problem.error, problem.question);
  return {
    kind: "needs-confirmation",
    confirmation: { summary: buildUnderstanding(checked.interpretation, plan, checked.dropped.length), fingerprint, proposed: checked.interpretation },
  };
}
