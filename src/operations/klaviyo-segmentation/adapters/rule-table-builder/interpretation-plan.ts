import type { ControlInfo } from "../../../../domain/types.ts";
import type { ModelInterpretation } from "../../interpretation/schema.ts";
import { KIND_NOT_TRACKED, MODIFIER_NOTE, MODIFIER_REASONS, NOT_TRACKED_LABEL } from "../../interpretation/not-tracked.ts";
import type { BehaviourTrace, EventPlan } from "./event-plan.ts";
import {
  buildControlIndex,
  clickedName,
  controlLabel,
  type ControlIndex,
  isFieldControl,
  type Group,
  MAX_SELECTORS_PER_LABEL,
  type PageControls,
  SCROLL_PERCENTS,
  selectorCandidates,
  selectorMatches,
} from "./match-controls.ts";
import { safeLabel } from "./safe-text.ts";
import { namesForbiddenGlobal } from "../../../shared/adapters/contract-lint/script-rules.ts";
import { MAX_EVENT_NAME_LENGTH } from "../../../shared/adapters/contract-lint/name-flow.ts";
import { EVENT_TAG } from "../../../shared/builder-script-marker.ts";

/** Longest list of behaviours turned into rules; the schema caps the interpretation well below this. */
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const SUPPORTED = (SCROLL_PERCENTS as readonly number[]).join(", ");

const describeControl = (c: ControlInfo): string => {
  const what = c.tag === "a" ? "link" : c.tag === "button" || (c.tag === "input" && /^(?:submit|button|reset|image)$/i.test(c.type ?? "")) ? "button" : c.tag === "summary" ? "FAQ question" : c.tag === "input" || c.tag === "textarea" || c.tag === "select" ? "field" : c.tag;
  return `${what} "${safeLabel(controlLabel(c), 40)}"`;
};

/**
 * Interpretation + page -> event plan. Deterministic and language-free: it looks names up on the page (match-controls.ts), snaps scroll
 * depths to the supported set, names events itself (Title Case), and lists everything it did not build with fixed wording.
 * Behaviours are processed in order; a repeated target or depth is one rule.
 */
export function planFromInterpretation(interpretation: ModelInterpretation, pages: PageControls[], eventTag?: string): EventPlan {
  const plan: EventPlan = { clicks: [], scrolls: [], unmatched: [], ambiguous: [], choices: [], notTracked: [], notes: [], pages: pages.map((p) => p.url), trace: [] };
  const indexes = new Map<boolean, ControlIndex>();
  const indexFor = (wantsField: boolean): ControlIndex => {
    let ix = indexes.get(wantsField);
    if (!ix) indexes.set(wantsField, (ix = buildControlIndex(pages, wantsField)));
    return ix;
  };
  const controls = pages.flatMap((p) => p.controls);
  const used = new Set<string>();
  // Names are unique within a script ignoring case: a repeat gets " 2", " 3" ("Clicked Search 2").
  // With an event tag every name ends in " (tag)"; the bare name is cut so the whole name stays within the event-name limit.
  const suffix = eventTag && EVENT_TAG.test(eventTag) ? ` (${eventTag})` : "";
  const uniqueName = (base: string): string => {
    const first = (base || "Event").slice(0, MAX_EVENT_NAME_LENGTH - suffix.length - 3).trim();
    let name = first;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${first} ${i}`;
    used.add(name.toLowerCase());
    return `${name}${suffix}`;
  };
  const trace = (t: BehaviourTrace) => plan.trace.push(t);

  // 1. Exclusions refuse everything: the builder only knows what to include, and building the rest would build the opposite.
  if (interpretation.unsupported.some((u) => u.reason === "exclusion")) {
    plan.refusal =
      `We can't leave things out yet: your description asks for something to be excluded, and this builder only knows what to include. ` +
      `List only the things you want tracked instead, for example: "Tell me when someone clicks Search."`;
    return plan;
  }

  // 2. Scroll depths
  const depths = new Set<number>();
  interpretation.behaviours.forEach((b, index) => {
    if (b.kind !== "scroll_depth" || b.depthPercent === undefined) return;
    const pct = b.depthPercent;
    const hit = SCROLL_PERCENTS.find((s) => Math.abs(s - pct) < 1e-6);
    if (hit !== undefined) {
      if (depths.has(hit)) return trace({ index, kind: "scroll", outcome: "duplicate" });
      depths.add(hit);
      const event = uniqueName(`Scrolled ${hit} Percent`);
      plan.scrolls.push({ percent: hit, event });
      return trace({ index, kind: "scroll", outcome: "built", event, percent: hit });
    }
    const shown = `${fmt(pct)}%`;
    plan.notTracked.push(
      pct > 100
        ? `scroll depth ${shown}: a page can only be scrolled up to 100% (supported: ${SUPPORTED}%)`
        : pct <= 0
          ? `scroll depth ${shown}: that is the top of the page (supported: ${SUPPORTED}%)`
          : `scroll depth ${shown} (supported: ${SUPPORTED}%)`,
    );
    trace({ index, kind: "scroll", outcome: "not-tracked" });
  });

  // 3. FAQ opens: every <summary> on the page, as one event
  let faqDone = false;
  interpretation.behaviours.forEach((b, index) => {
    if (b.kind !== "faq_open") return;
    if (faqDone) return trace({ index, kind: "faq", outcome: "duplicate" });
    faqDone = true;
    const summaries = controls.filter((c) => c.tag === "summary");
    if (summaries.length === 0) {
      plan.unmatched.push("FAQ (no FAQ questions found on the page)");
      plan.refusal = "We could not find any FAQ questions on the page you saved, so there is nothing to track for them. Save a page that shows the questions, or ask for something else.";
      return trace({ index, kind: "faq", outcome: "problem" });
    }
    const event = uniqueName("Opened FAQ");
    plan.clicks.push({
      event,
      selector: "summary",
      label: "FAQ",
      why: `every FAQ question on the page (${summaries.length} <summary> elements) fires this one event, by design; a click on any <summary> also counts for it`,
    });
    trace({ index, kind: "faq", outcome: "built", event, control: `${summaries.length} FAQ question${summaries.length === 1 ? "" : "s"}` });
  });
  if (plan.refusal) {
    plan.clicks = [];
    plan.scrolls = [];
    return plan;
  }

  // 4. Named clicks
  const seen = new Set<string>();
  interpretation.behaviours.forEach((b, index) => {
    if (b.kind !== "click" || b.target === undefined) return;
    const heading = b.heading;
    const res = indexFor(b.field === true).resolve(b.target, heading);
    if (res.kind === "none") {
      plan.unmatched.push(heading ? `${b.target} under ${heading}` : b.target);
      return trace({ index, kind: "click", outcome: "problem", target: b.target });
    }
    if (res.kind === "unusable") {
      plan.notTracked.push(`"${safeLabel(res.label, 40)}": its name has no letters we can use in an event name, so it cannot be tracked`);
      return trace({ index, kind: "click", outcome: "not-tracked", target: b.target });
    }
    const g: Group = res.group;
    if (seen.has(g.key)) return trace({ index, kind: "click", outcome: "duplicate", target: b.target });
    seen.add(g.key);
    const ix = indexFor(b.field === true);
    if (g.kind === "field") {
      plan.notTracked.push(`"${safeLabel(g.label)}": that is a text field, and a click rule cannot see typing, so fields are not tracked unless you say "field" or "box" (for example: clicks the ${safeLabel(g.label)} box)`);
      return trace({ index, kind: "click", outcome: "not-tracked", target: b.target });
    }
    // "the Search box" said of something that is a link or button on the page: not guessed at, and not built as a click.
    if (b.field === true && g.ctrls.length > 0 && !g.ctrls.some(isFieldControl)) {
      plan.notTracked.push(`"${safeLabel(g.label, 40)}": on the page it is a ${describeControl(g.ctrls[0]!).split(" ")[0]}, not a text box, so we did not track it as one. If you meant the ${describeControl(g.ctrls[0]!).split(" ")[0]}, ask for it without the word box`);
      return trace({ index, kind: "click", outcome: "not-tracked", target: b.target });
    }
    if (g.kind === "clash") {
      plan.ambiguous.push(g.options!);
      return trace({ index, kind: "click", outcome: "problem", target: b.target });
    }
    if (g.kind === "hidden" || g.kind === "short") {
      (plan.blocked ??= []).push({ label: safeLabel(g.label), reason: g.kind });
      plan.notTracked.push(g.kind === "hidden" ? `"${safeLabel(g.label)}": it is hidden on the saved page (hidden attribute or display:none), so it cannot be clicked there` : `"${safeLabel(g.label)}": its name is under 3 letters or digits, which is too short to match reliably`);
      return trace({ index, kind: "click", outcome: "problem", target: b.target });
    }
    if (g.skipped) plan.notTracked.push(...g.skipped);
    if (g.kind === "split") {
      plan.choices.push({ kind: "label", name: g.label, options: g.options!, behaviourIndex: index });
      return trace({ index, kind: "click", outcome: "choice", target: b.target });
    }
    if (g.kind === "heading" && g.options) {
      plan.choices.push({ kind: "heading", name: g.label, options: g.options, behaviourIndex: index });
      return trace({ index, kind: "click", outcome: "choice", target: b.target });
    }
    const own = new Set(g.ctrls);
    const others = controls.filter((c) => !own.has(c));
    const chosen = new Map<string, string>();
    const clash = new Set<string>();
    let missing = false;
    for (const c of g.ctrls) {
      // A selector that would spell a forbidden name inside the script (an id like "klaviyo-signup") is never used: it would fail the lint.
      const cands = selectorCandidates(c, ix.optionsFor(c)).filter((cand) => !namesForbiddenGlobal(cand.selector));
      if (cands.length === 0) {
        missing = true;
        continue;
      }
      const ok = cands.find((cand) => !others.some((o) => selectorMatches(cand.selector, o)));
      if (ok) {
        chosen.set(ok.selector, ok.why);
        continue;
      }
      // Nothing separates it: name the controls the least-clashing candidate also matches.
      let least: ControlInfo[] | undefined;
      for (const cand of cands) {
        const m = others.filter((o) => selectorMatches(cand.selector, o));
        if (!least || m.length < least.length) least = m;
      }
      for (const o of least ?? []) clash.add(controlLabel(o) || `an unnamed <${o.tag}>`);
    }
    if (clash.size > 0) {
      plan.ambiguous.push([g.label, ...[...clash].slice(0, 4)]);
      return trace({ index, kind: "click", outcome: "problem", target: b.target });
    }
    if (chosen.size === 0 || missing) {
      if (chosen.size === 0) {
        plan.unmatched.push(`${safeLabel(g.label)} (found on the page, but it has no stable id, class or aria-label to select it by)`);
        (plan.unselectable ??= []).push(safeLabel(g.label));
        return trace({ index, kind: "click", outcome: "problem", target: b.target });
      }
      plan.notTracked.push(`"${safeLabel(g.label)}": one copy of it on the page has no stable id, class or aria-label, so that copy is not tracked`);
    }
    // "Clicked <label>"; for "<label> under <Heading>" (a generic button named with its heading): "Clicked <label> <Heading>".
    const eventBase = g.kind === "pair" ? clickedName(g.base!, g.heading!) : clickedName(g.label);
    // A name that would fail the script check (it spells a name the script may never contain) is told to the merchant now, never offered.
    if (namesForbiddenGlobal(eventBase) || namesForbiddenGlobal(g.label)) {
      plan.notTracked.push(`"${safeLabel(g.label, 40)}": we can't track a button named that`);
      return trace({ index, kind: "click", outcome: "not-tracked", target: b.target });
    }
    const all = [...chosen.entries()];
    if (all.length > MAX_SELECTORS_PER_LABEL) plan.notTracked.push(`"${safeLabel(g.label)}": ${all.length} different copies on the page, only the first ${MAX_SELECTORS_PER_LABEL} are tracked`);
    const use = all.slice(0, MAX_SELECTORS_PER_LABEL);
    // Same name, different destinations (two "Sign Up" links with different addresses): built as ONE event, and said so.
    if (g.kind === "label" && new Set(g.ctrls.map((c) => c.href).filter((h): h is string => !!h)).size >= 2) {
      plan.notes.push(`"${safeLabel(g.label)}": ${g.ctrls.length} controls on the page have this name and go to different link addresses. They are tracked together as ONE event; if you need them apart, give each its own id or aria-label, save the page again, and ask for each by name.`);
    }
    if (g.ctrls.length > 0 && g.ctrls.every((c) => c.hiddenAtSave)) plan.notes.push(`"${safeLabel(g.label)}": your saved page marks this hidden, often because a script shows it later. It was built anyway; check that visitors can see it.`);
    if (g.looseWords) plan.notes.push(`"${safeLabel(g.label)}": your words had extra words around this control's name. It was the only control that fits, so it was used; check it is the one you meant.`);
    if (g.loose) plan.notes.push(`"${safeLabel(g.label)}": the page's name for this control has punctuation your words did not. It was the only control with that name, so it was matched ignoring the punctuation; check it is the one you meant.`);
    const selector = use.map(([s]) => s).join(", ");
    if (namesForbiddenGlobal(selector)) {
      plan.unmatched.push(`${safeLabel(g.label)} (found on the page, but it has no stable id, class or aria-label to select it by)`);
      (plan.unselectable ??= []).push(safeLabel(g.label));
      return trace({ index, kind: "click", outcome: "problem", target: b.target });
    }
    const event = uniqueName(eventBase);
    plan.clicks.push({ event, selector, label: g.label, why: use[0]![1] });
    // The page's own wording for the control (not the model's): "Search", or "Learn More" under "Fitness for Everyone".
    const shownLabel = g.kind === "pair" ? g.base! : g.kind === "heading" ? controlLabel(g.ctrls[0]!) : g.label;
    const shownHeading = g.kind === "pair" || g.kind === "heading" ? g.heading : undefined;
    trace({ index, kind: "click", target: b.target, ...(heading ? { heading } : {}), outcome: "built", event, control: describeControl(g.ctrls[0]!), label: shownLabel, ...(shownHeading ? { labelHeading: shownHeading } : {}) });
  });

  // 5. Kinds the script cannot record, and the model's own "not supported" list: fixed wording only.
  interpretation.behaviours.forEach((b, index) => {
    const label = KIND_NOT_TRACKED[b.kind];
    if (label) {
      plan.notTracked.push(label);
      trace({ index, kind: "other", outcome: "not-tracked" });
    }
  });
  let modifier = false;
  for (const u of interpretation.unsupported) {
    if (u.reason === "exclusion") continue;
    plan.notTracked.push(NOT_TRACKED_LABEL[u.reason]);
    if (MODIFIER_REASONS.has(u.reason)) modifier = true;
  }
  if (modifier) plan.notes.push(MODIFIER_NOTE);

  plan.notTracked = [...new Set(plan.notTracked)];
  plan.notes = [...new Set(plan.notes)];
  plan.unmatched = [...new Set(plan.unmatched)];
  return plan;
}
