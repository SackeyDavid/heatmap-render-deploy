/** What the builder will emit, and what it could not. Built by interpretation-plan.ts from an approved interpretation and the page. */
export interface ClickRule {
  event: string;
  selector: string;
  label: string;
  /** Why this selector was chosen, for notes.md. */
  why: string;
}

export interface ScrollRule {
  percent: number;
  event: string;
}

export interface Choice {
  /** "label": the target names a label that exists under several headings; "heading": it names a heading that holds several generic buttons. */
  kind: "label" | "heading";
  /** The label (kind "label") or the heading (kind "heading"), as on the page. */
  name: string;
  /** The headings (kind "label") or the button labels (kind "heading") to choose from, in page order. */
  options: string[];
  /** Index (in the interpretation's behaviours) of the behaviour this choice is about. */
  behaviourIndex: number;
}

export interface EventPlan {
  clicks: ClickRule[];
  scrolls: ScrollRule[];
  /** Click targets that cannot be built: not on the page, or no stable selector. Any entry makes the build refuse. */
  unmatched: string[];
  /** Labels of controls that ARE on the page but have nothing we can safely select them by. Their entries are also in `unmatched`. */
  unselectable?: string[];
  /** Groups of labels whose controls cannot be told apart by any selector the builder can emit. Any entry makes the build refuse. */
  ambiguous: string[][];
  /** Names that match several different controls. Any entry is a question to the merchant (never a guess). */
  choices: Choice[];
  /** Recognised-but-unsupported parts. The rest is still built; notes.md lists these. */
  notTracked: string[];
  /** Things the merchant should know about what WAS built. notes.md lists these. */
  notes: string[];
  pages: string[];
  /** Controls the interpretation names that exist in the saved page but cannot be built, with the true reason. Any entry makes the build refuse. */
  blocked?: { label: string; reason: "hidden" | "short" }[];
  /** Set when the whole request must be refused (an exclusion). The plan then has no clicks or scrolls. */
  refusal?: string;
  /** What each behaviour of the interpretation turned into, in order, for the confirmation screen. */
  trace: BehaviourTrace[];
}

export type BehaviourTrace =
  | { index: number; kind: "click"; target: string; heading?: string; outcome: "built"; event: string; control: string; label: string; labelHeading?: string }
  | { index: number; kind: "faq"; outcome: "built"; event: string; control: string }
  | { index: number; kind: "scroll"; outcome: "built"; event: string; percent: number }
  | { index: number; kind: "click" | "faq" | "scroll" | "other"; outcome: "choice" | "problem" | "not-tracked" | "duplicate"; target?: string };
