/** A model sometimes files "hovers over X" or "types in X" as a click. Those are not clicks. One list, used by the validator and the control matcher. */
export const NOT_A_CLICK: { pattern: RegExp; reason: "hover" | "typing" }[] = [
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

/**
 * Which "not a click" reason applies to the words AROUND the control's name, if any. The control's own name (and heading) is taken out
 * first, so a button called "Types of Yoga" or "Hover Boards" is a click. Honest limit: a model that puts the verb into the name can
 * only get a click built when the page has a control with that exact label, or (extra-words rule in match-controls.ts) when the extra
 * words carry no trigger word; the merchant also approves what was understood.
 */
export function notAClickReason(evidence: string, target: string | undefined, heading: string | undefined): "hover" | "typing" | undefined {
  const rest = withoutLastOccurrence(withoutLastOccurrence(evidence, target), heading);
  return NOT_A_CLICK.find((n) => n.pattern.test(rest))?.reason;
}
