import type { ControlInfo } from "../../../../domain/types.ts";
import type { Choice, EventPlan } from "./event-plan.ts";
import { interpretationFromUnknown } from "../../interpretation/from-unknown.ts";
import { planFromInterpretation } from "./interpretation-plan.ts";
import type { PageControls } from "./match-controls.ts";
import { boundQuestion, listLabels, listPageLabels, MAX_QUESTION_CHARS, MAX_SHOWN_LABEL, MAX_SHOWN_LABELS, safeLabel } from "./safe-text.ts";
import { renderNotes, renderScript, renderSegments } from "./render.ts";

/**
 * What the builder reads from the workspace through the deterministic runner: the page's controls (inspect step) and the interpretation
 * the merchant APPROVED (confirm step). The merchant's own text is not an input: this module never reads prose.
 */
export const BUILDER_INPUTS = ["pages/controls.json", "interpretation.json", "event-tag.txt"];

/**
 * `error` is the full internal reason (job record, email log). `question` is the merchant-facing version: one of a few fixed
 * templates plus page labels that were reduced to a safe character set; it never contains the merchant's own request text.
 */
type Built = { ok: true; files: Record<string, string>; summary: string } | { ok: false; error: string; question?: string };

const titleish = (s: string) => (s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/\b\p{L}/gu, (m) => m.toUpperCase()) : s);

/** "There are 3 buttons called LEARN MORE, under: A, B, C. Say which one, for example: clicks Learn More under C." */
export function choiceMessage(c: Pick<Choice, "kind" | "name" | "options">, fit: { labels: number; width: number } = { labels: MAX_SHOWN_LABELS, width: MAX_SHOWN_LABEL }): string {
  const shown = listLabels(c.options, fit.labels, fit.width);
  const name = safeLabel(c.name, fit.width) || "this button";
  const last = [...c.options].reverse().map((o) => safeLabel(o, fit.width)).find((o) => o.length > 0);
  if (c.kind === "label") {
    return `There are ${c.options.length} buttons called ${name}, under: ${shown || "(names we cannot show)"}.${last ? ` Say which one, for example: clicks ${titleish(name)} under ${last}.` : " Say which one."}`;
  }
  return `There are ${c.options.length} buttons under ${name}: ${shown || "(names we cannot show)"}.${last ? ` Say which one, for example: clicks ${titleish(last)} under ${name}.` : " Say which one."}`;
}

/** The merchant-facing form: the label list (never the "Say which one" instruction) is shrunk until the whole question fits. */
export function choiceQuestion(c: Pick<Choice, "kind" | "name" | "options">): string {
  for (const fit of [{ labels: MAX_SHOWN_LABELS, width: MAX_SHOWN_LABEL }, { labels: 3, width: 40 }, { labels: 2, width: 30 }, { labels: 1, width: 24 }, { labels: 1, width: 16 }]) {
    const m = choiceMessage(c, fit);
    if (m.length <= MAX_QUESTION_CHARS) return m;
  }
  return boundQuestion(choiceMessage(c, { labels: 1, width: 12 }));
}

/**
 * The missing names, for the refusal: only short plain words the merchant typed (letters and digits, at most 4 words, nothing that looks like
 * code), Title Cased, at most 3. Entries with a note in brackets (FAQ, "found on the page") are left out.
 */
const CODE_WORDS = /\b(?:javascript|script|alert|eval|onerror|fetch|http|https|www|klaviyo|learnq|document|window)\b/;
function missingNames(missing: string[]): string {
  const plain = missing.filter((u) => /^[a-z0-9]+(?: [a-z0-9]+){0,3}$/.test(u) && u.length <= 40 && !CODE_WORDS.test(u));
  return listLabels(plain.map((u) => u.replace(/\b[a-z]/g, (m) => m.toUpperCase())), 3, 40);
}

/** The first thing that stops a build, as the full internal reason (`error`) and the merchant-facing question; undefined when the plan can be built. */
export function planProblem(plan: EventPlan, pages: PageControls[]): { error: string; question: string } | undefined {
  if (plan.refusal) return { error: plan.refusal, question: boundQuestion(plan.refusal) };
  if (plan.ambiguous.length > 0) {
    return {
      error: plan.ambiguous.map((labels) => `These buttons look the same to us (${labels.join(", ")}): give each its own id or aria-label on the page (or different classes), save the page again, then ask again.`).join(" "),
      question: boundQuestion(`Some buttons look the same to us (${listLabels(plan.ambiguous[0] ?? [])}). Give each its own id or aria-label on the page, save the page again, then ask again.`),
    };
  }
  // Controls the interpretation names that exist on the page but are hidden there, or have too short a name: said plainly, never "not found".
  const blocked = plan.blocked ?? [];
  if (blocked.length > 0) {
    const hid = [...new Set(blocked.filter((b) => b.reason === "hidden").map((b) => b.label))];
    const short = [...new Set(blocked.filter((b) => b.reason === "short").map((b) => b.label))];
    const parts: string[] = [];
    if (hid.length > 0) {
      const one = hid.length === 1;
      parts.push(`We can see ${listLabels(hid, 3, 40) || "a button or link"} in the saved page, but ${one ? "it is" : "they are"} hidden there (the page marks ${one ? "it" : "them"} hidden or display:none), so ${one ? "it cannot" : "they cannot"} be clicked and we did not build ${one ? "it" : "them"}. Save the page with ${one ? "it" : "them"} showing, then ask again.`);
    }
    if (short.length > 0) {
      const one = short.length === 1;
      parts.push(`We can see ${listLabels(short, 3, 40) || "a button or link"} on the page, but ${one ? "its name is" : "their names are"} under 3 letters or digits, which is too short to match reliably. Give ${one ? "it" : "each"} a longer visible name or aria-label, save the page again, then ask again.`);
    }
    const message = parts.join(" ");
    return { error: message, question: boundQuestion(message) };
  }
  // Controls that ARE on the page but cannot be selected safely are not "not found": say so, by their cleaned label.
  const unsafe = plan.unselectable ?? [];
  const unsafeEntry = (u: string) => unsafe.some((l) => u.startsWith(`${l} (found on the page`));
  const missing = plan.unmatched.filter((u) => !unsafeEntry(u));
  if (unsafe.length > 0) {
    const names = listLabels(unsafe, 3, 40) || "a button or link";
    const one = unsafe.length === 1;
    const also = missing.length > 0 ? ` We also could not find ${missingNames(missing) || (missing.length === 1 ? "one other name you gave" : `${missing.length} other names you gave`)}.` : "";
    return {
      error: `We can see ${names} on the page, but we cannot track ${one ? "it" : "them"} safely: ${one ? "its" : "their"} markup has no plain id, class or label, or has characters a tracking rule cannot use. Ask whoever built the page to give ${one ? "it" : "each"} a simple id, save the page again, then ask again.${also}`,
      question: boundQuestion(`We can see ${names} on the page, but we cannot track ${one ? "it" : "them"} safely: ${one ? "its" : "their"} markup has no plain id or label, or has characters a tracking rule cannot use. Ask whoever built the page to give ${one ? "it" : "each"} a simple id, save the page again, then ask again.${also}`),
    };
  }
  if (missing.length > 0) {
    const onPage = listPageLabels(pages.flatMap((p) => p.controls.map((c) => c.ariaLabel || c.text)));
    const shown = missingNames(missing);
    return {
      error: `We could not find on the page: ${missing.map((u) => `"${u}"`).join(", ")}. Name each button or link exactly as it appears on the page.`,
      question: boundQuestion(`We could not find ${missing.length === 1 ? "one of the buttons or links" : `${missing.length} of the buttons or links`} you named on the page${shown ? ` (${shown})` : ""}. Name each one exactly as it appears on the page${onPage ? `. Some we can see: ${onPage}` : ""}.`),
    };
  }
  if (plan.clicks.length + plan.scrolls.length === 0 && plan.choices.length === 0) {
    const example = `Say which button or link visitors click, or how far down the page they scroll, for example: "Tell me when someone clicks Search" or "when they scroll 50 percent".`;
    // The internal reason lists everything not tracked; the merchant-facing question repeats only the fixed names (entries that quote a page label are left out).
    const all = plan.notTracked.length ? ` Not tracked: ${plan.notTracked.join("; ")}.` : "";
    const fixed = plan.notTracked.filter((n) => !n.includes('"'));
    const quoted = plan.notTracked.filter((n) => n.includes('"'));
    // One short reason sentence, then the example once. A page-label reason (a button we can't track) is said in its own fixed words.
    const firstQuoted = quoted[0]?.replace(/^"[^"]*":\s*/, "");
    const hint = fixed.length ? ` Not tracked: ${fixed.join("; ")}.` : firstQuoted ? ` ${firstQuoted.charAt(0).toUpperCase()}${firstQuoted.slice(1)}.` : "";
    return { error: `We could not tell what to track from that description.${all} ${example}`, question: boundQuestion(`We could not tell what to track from that description.${hint} ${example}`) };
  }
  return undefined;
}

/** Reads the page controls the inspect step wrote. */
export function readPages(controlsJson: string | undefined): PageControls[] | undefined {
  try {
    const raw = JSON.parse(controlsJson ?? "[]") as { url: string; controls?: ControlInfo[]; hiddenControls?: ControlInfo[] }[];
    return raw.map((p) => ({ url: p.url, controls: p.controls ?? [], ...(p.hiddenControls?.length ? { hiddenControls: p.hiddenControls } : {}) }));
  } catch {
    return undefined;
  }
}

/**
 * The builder: approved interpretation + page controls -> script.js, segments.json, notes.md. Pure. Nothing here reads the merchant's
 * description; a missing or unreadable interpretation is a refusal, never a fallback to reading prose.
 */
export function ruleTableBuild(args: { inputs: Record<string, string> }): Built {
  const pages = readPages(args.inputs["pages/controls.json"]);
  if (!pages) return { ok: false, error: "could not read the page controls the inspect step writes (pages/controls.json)" };
  const interpretation = interpretationFromUnknown(args.inputs["interpretation.json"]);
  if (!interpretation) {
    const msg = "We have no reading of your request to build from. Either the helper in your browser or our assistant has to read your description first; nothing was guessed.";
    return { ok: false, error: msg, question: msg };
  }
  const tag = (args.inputs["event-tag.txt"] ?? "").trim();
  const plan = planFromInterpretation(interpretation, pages, tag || undefined);
  if (plan.choices.length > 0 && !plan.refusal) {
    const msg = plan.choices.map((c) => choiceMessage(c)).join(" ");
    return { ok: false, error: msg, question: boundQuestion(choiceQuestion(plan.choices[0]!)) };
  }
  const problem = planProblem(plan, pages);
  if (problem) return { ok: false, ...problem };
  return {
    ok: true,
    files: { "script.js": renderScript(plan), "segments.json": renderSegments(plan), "notes.md": renderNotes(plan) },
    summary: `rule-table builder: ${plan.clicks.length} click rule(s), ${plan.scrolls.length} scroll rule(s)`,
  };
}
