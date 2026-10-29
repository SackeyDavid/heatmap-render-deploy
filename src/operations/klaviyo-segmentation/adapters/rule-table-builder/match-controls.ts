import type { ControlInfo } from "../../../../domain/types.ts";
import { NOT_A_CLICK } from "../../interpretation/not-a-click.ts";
import { safeLabel } from "./safe-text.ts";

export interface PageControls {
  url: string;
  controls: ControlInfo[];
  /** Controls that are in the markup but hidden (hidden attribute, display:none). Never built; kept so naming one gets a specific answer. */
  hiddenControls?: ControlInfo[];
}

/**
 * Matching NAMED targets to REAL page controls. This module reads the saved page and compares names; it never reads the merchant's
 * description. A target arrives already extracted by a model (interpretation/schema.ts); here it is looked up by its normalised words.
 *
 * What it guarantees (the rules the builder is held to, none of them about language):
 *   - a name that matches one control (or its same-looking desktop/mobile copies) resolves to it; a name that matches nothing is "unmatched";
 *   - a label shared by controls under DIFFERENT headings, or a generic call to action ("Learn More"), can be qualified by its heading
 *     ({ target: "Learn More", heading: "Fitness for Everyone" }) or the heading can be the target; an unqualified shared label is a CHOICE;
 *   - form fields are targets only when the interpretation says field:true; hidden and too-short names are reported as that;
 *   - a selector is chosen only from page attributes and only if no OTHER control matches it (selectorCandidates + selectorMatches).
 */

export const SCROLL_PERCENTS = [25, 50, 75, 90, 100] as const;
export const MAX_SELECTORS_PER_LABEL = 3;

const ASCII_FIXES: Record<string, string> = { "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };

/** Lower-case-able ASCII approximation: diacritics removed (Café -> Cafe), curly quotes straightened. */
export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ßæœøłđðþı]/gi, (m) => ASCII_FIXES[m.toLowerCase()] ?? m)
    .replace(/[\u2018\u2019\u201B\u02BC`\u00B4]/g, "'");
}

export const norm = (s: string): string => fold(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Short words a Title Case name keeps lower case (except as the first word): matches "Clicked 15 Minutes to Fit", "Clicked Fitness for Everyone". */
const SMALL_WORDS = new Set("a an and as at but by for in of on or the to vs via with".split(" "));
/** Acronyms kept upper case when a page label is ALL CAPS (the page cannot tell us which short words are acronyms, so this list does). Not "US"/"ID": those are ordinary words. */
const KNOWN_ACRONYMS = new Set("EMS FAQ FAQS CBD CEO CFO CRM API SEO SMS PDF VIP DIY ROI USA UK UV HD TV AI HIIT GPS BMI RSVP B2B B2C".split(" "));
/** Longest label part of an event name (the "Clicked " prefix comes on top). */
const MAX_EVENT_LABEL = 60;

/** At most 60 characters, cut at a word where there is one. */
const capLabel = (t: string): string => (t.length > MAX_EVENT_LABEL ? t.slice(0, MAX_EVENT_LABEL).replace(/\s+\S*$/, "").trim() || t.slice(0, MAX_EVENT_LABEL) : t);

/**
 * Event-name text from a page label: ascii only (accents folded), only letters, digits, spaces and ' & - (anything else becomes a space),
 * spaces collapsed, at most 60 characters (cut at a word). The page's own casing is kept ("Full Body EMS Workout"); a label that is all
 * lower case or all upper case is converted to Title Case ("FREE SESSION" -> "Free Session"), with small words ("to", "for") lower case
 * and, for all-caps labels, only the acronyms in KNOWN_ACRONYMS (and words with digits) kept as written.
 */
export function eventLabel(label: string, cap: boolean = true): string {
  let t = safeLabel(fold(label), 400)
    .replace(/[^A-Za-z0-9 &'-]/g, " ")
    .replace(/(?<![A-Za-z0-9])['-]+|['-]+(?![A-Za-z0-9])/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ &]+|[ &]+$/g, "");
  if (cap) t = capLabel(t);
  const hasLetters = /[A-Za-z]/.test(t);
  const allUpper = hasLetters && t === t.toUpperCase();
  const allLower = hasLetters && t === t.toLowerCase();
  if (allUpper || allLower) {
    t = t
      .split(" ")
      .map((w, i) => {
        if (allUpper && (KNOWN_ACRONYMS.has(w) || (/\d/.test(w) && /[A-Z]/.test(w)))) return w;
        const lower = w.toLowerCase();
        if (i > 0 && SMALL_WORDS.has(lower)) return lower;
        return lower.replace(/(^|-)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
      })
      .join(" ");
  }
  return t;
}

/**
 * "Clicked " + the page label ("Clicked Search"). Several parts ("Learn More", then the heading) are each cased on their own, joined with a
 * space, and the whole label is capped at 60 characters.
 */
export const clickedName = (...parts: string[]): string => {
  const joined = capLabel(parts.map((p) => eventLabel(p, false)).filter((p) => p.length > 0).join(" "));
  // A page label that already starts with the verb ("Clicked Search 2") is not given a second one.
  const rest = joined.replace(/^clicked\s+/i, "").trim();
  return `Clicked ${rest || (/^clicked$/i.test(joined) ? "Button" : joined) || "Button"}`;
};

export function controlLabel(c: ControlInfo): string {
  return (c.ariaLabel || c.text || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Classes that describe a momentary state, not the element: never used in a selector. */
const STATE_CLASS = /^(?:active|open|opened|current|selected|show|shown|visible|hidden|disabled|focus|focused|hover|expanded|collapsed|is-[A-Za-z0-9_-]+|has-[A-Za-z0-9_-]+|current-[A-Za-z0-9_-]+)$/i;
/** Grid / spacing utility classes that end in a number but say nothing about which element this is. */
const LAYOUT_CLASS = /^(?:col|row|mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py|p|m|w|h|gap|grid|order|offset|fa|fa-[a-z]+|col-[a-z]+|text|font|size|z|g|gx|gy)(?:-|$)/i;

const safeAttr = (v: string) => /^[A-Za-z0-9_.:\- ]{1,80}$/.test(v) && !/['"\\]/.test(v);

/** Longest href put into a selector. */
const MAX_SELECTOR_HREF = 120;
/**
 * An href a selector may carry: an absolute http(s) URL, a root-relative path, or a bare origin. Only plain characters (no quotes,
 * brackets, spaces, commas, '#', '?', '&', '=', control characters: a query string is not a stable identity, and jsdom's selector engine
 * mis-reads it); never protocol-relative ("//host"), "#anchor", "javascript:" or "mailto:".
 */
const HREF_FORM = /^(?!\/\/)(?:https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)?(?:\/[A-Za-z0-9_.~%:@+-]*)+$|^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;
export const hrefSafe = (h: string): boolean => h.length <= MAX_SELECTOR_HREF && HREF_FORM.test(h);
const ID_FORM = /^[A-Za-z][A-Za-z0-9_-]{0,60}$/;

/** A class carried by more than this many OTHER controls that have a different label is a theme utility class (fusion-bar-highlight), not an identity. */
export const UTILITY_CLASS_MAX_OTHERS = 3;

export interface CandidateOptions {
  /** True for a class that describes many unrelated controls; such a class is never put into a selector. Default: none. */
  utility?: (cls: string) => boolean;
}

/**
 * Selectors for one control built only from stable, exact attributes, most preferred first. The forms are exactly:
 *   tag#id                                    its own id
 *   tag.numbered[data-target='x']             numbered class + data-target   (a.button-4[data-target='.fusion-modal.fitnessvideo'])
 *   tag.c1.c2[data-target='x']
 *   tag.c1.c2[aria-label='x']                 classes + aria-label           (a.fusion-main-menu-icon[aria-label='Search'])
 *   tag[aria-label='x']
 *   tag.numbered, tag.c1.c2                   classes only
 *   a[href='x']                               a plain link address (hrefSafe)
 *   #parentId > tag                           the id of the DIRECT parent    (#menu-item-3468 > a)
 * Utility classes (opts.utility) and state classes are left out before any of these are built. (`summary` for FAQ is separate.)
 */
export function selectorCandidates(c: ControlInfo, opts: CandidateOptions = {}): { selector: string; why: string }[] {
  const out: { selector: string; why: string }[] = [];
  // The tag name comes from the saved page: only a plain element name may enter a selector (never a comma, bracket, space...).
  if (!TAG_FORM.test(c.tag)) return out;
  const idSafe = c.id && ID_FORM.test(c.id);
  if (idSafe) out.push({ selector: `${c.tag}#${c.id}`, why: "its id" });
  const valid = (c.classes ?? []).filter((k) => /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(k) && !STATE_CLASS.test(k) && !opts.utility?.(k));
  // A numbered variant class (button-4, menu-item-12) is the most specific single class a theme gives; prefer it alone.
  const numbered = valid.find((k) => /^[A-Za-z][A-Za-z-]*-\d{1,4}$/.test(k) && !LAYOUT_CLASS.test(k));
  const classes = valid.slice(0, 3);
  const cls = classes.length > 0 ? `.${classes.join(".")}` : "";
  const dataTarget = c.data?.target;
  if (dataTarget && safeAttr(dataTarget)) {
    if (numbered) out.push({ selector: `${c.tag}.${numbered}[data-target='${dataTarget}']`, why: "its numbered class and data-target (distinguishes it from look-alike buttons)" });
    if (classes.length > 0) out.push({ selector: `${c.tag}${cls}[data-target='${dataTarget}']`, why: "its class and data-target (distinguishes it from look-alike buttons)" });
  }
  if (c.ariaLabel && safeAttr(c.ariaLabel)) {
    if (classes.length > 0) out.push({ selector: `${c.tag}${cls}[aria-label='${c.ariaLabel}']`, why: "its class and aria-label" });
    out.push({ selector: `${c.tag}[aria-label='${c.ariaLabel}']`, why: "its aria-label" });
  }
  if (numbered) out.push({ selector: `${c.tag}.${numbered}`, why: "its numbered class (no id or aria-label on the page)" });
  if (classes.length > 0) out.push({ selector: `${c.tag}${cls}`, why: "its classes (no id or aria-label on the page)" });
  if (c.tag === "a" && c.href && hrefSafe(c.href)) out.push({ selector: `a[href='${c.href}']`, why: "its link address (href); no id, aria-label or class of its own tells it apart" });
  if (c.ancestorId && ID_FORM.test(c.ancestorId) && /^[A-Za-z][A-Za-z0-9]*$/.test(c.tag)) out.push({ selector: `#${c.ancestorId} > ${c.tag}`, why: "the id of the element it sits directly in (it has no id, aria-label, class or link address that tells it apart)" });
  return out;
}

/** The first (most preferred) selector for a control, or undefined when nothing stable exists. */
export function selectorFor(c: ControlInfo): { selector: string; why: string } | undefined {
  return selectorCandidates(c)[0];
}

/** Element names allowed in a selector. */
const TAG_FORM = /^[a-z][a-z0-9-]{0,31}$/;
const SELECTOR_FORM = /^([A-Za-z][A-Za-z0-9]*)(?:#([A-Za-z][A-Za-z0-9_-]*))?((?:\.[A-Za-z][A-Za-z0-9_-]*)*)(?:\[(data-target|aria-label|href)='([^']*)'\])?$/;
const ANCESTOR_FORM = /^#([A-Za-z][A-Za-z0-9_-]*) > ([A-Za-z][A-Za-z0-9]*)$/;

/** Does a selector in one of the forms this builder emits match this control? (Unknown forms match nothing: callers only pass emitted forms.) */
export function selectorMatches(selector: string, c: ControlInfo): boolean {
  return selector.split(", ").some((one) => {
    const anc = ANCESTOR_FORM.exec(one);
    if (anc) return c.ancestorId === anc[1] && c.tag.toLowerCase() === anc[2]!.toLowerCase();
    const m = SELECTOR_FORM.exec(one);
    if (!m) return false;
    const [, tag, id, cls, attr, value] = m;
    if (tag!.toLowerCase() !== c.tag.toLowerCase()) return false;
    if (id !== undefined && c.id !== id) return false;
    const wanted = (cls ?? "").split(".").filter(Boolean);
    if (wanted.some((k) => !(c.classes ?? []).includes(k))) return false;
    if (attr === "data-target" && c.data?.target !== value) return false;
    if (attr === "aria-label" && c.ariaLabel !== value) return false;
    if (attr === "href" && c.href !== value) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Things the builder understands but cannot build: your own event names, counts, conditions, page limits
// ---------------------------------------------------------------------------------------------------------------

const BUTTON_LIKE_INPUT = new Set(["submit", "button", "reset", "image"]);
/** A control the visitor types into or chooses a value in: input (not a button), textarea, select. */
export const isFieldControl = (c: ControlInfo): boolean => c.tag === "textarea" || c.tag === "select" || (c.tag === "input" && !BUTTON_LIKE_INPUT.has((c.type ?? "").toLowerCase()));
export const hasNonAsciiLetters = (s: string) => /\p{L}/u.test(fold(s).replace(/[\x00-\x7F]/g, ""));
export const GENERIC_LABELS = new Set(["learn more", "read more", "shop now", "click here", "more", "view", "see more", "get started", "view more", "find out more", "discover more"]);
export const headingOf = (c: ControlInfo): string => (c.heading ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

// ---------------------------------------------------------------------------------------------------------------
// The control index: what names the page offers, and how a named target resolves to controls
// ---------------------------------------------------------------------------------------------------------------

export interface Group {
  /** Normalised words a target is looked up by (a pair is "label heading", for ordering only). */
  n: string;
  /** Unique across kinds. */
  key: string;
  label: string;
  ctrls: ControlInfo[];
  kind: "label" | "split" | "heading" | "pair" | "field" | "clash" | "hidden" | "short";
  /** The only control(s) with this name differ from the target's wording by punctuation ("Search ..."): built, but notes.md says so. */
  loose?: boolean;
  /** The target had extra words around the page's name for the control ("Claim Free Session button"); matched by the name inside it. */
  looseWords?: boolean;
  /** Same-named controls that were left out (and why); listed as not tracked when the group is named. */
  skipped?: string[];
  /** For heading and pair groups: the heading as on the page. For pair groups `base` is the button's own label. */
  heading?: string;
  base?: string;
  labelN?: string;
  headingN?: string;
  /** For split groups: the distinct headings. For heading groups with several labels: those labels. */
  options?: string[];
}

export interface ControlIndex {
  controls: ControlInfo[];
  /** Names of controls with no usable letters (another alphabet), by lower-cased raw label. */
  unusable: Map<string, string>;
  optionsFor(c: ControlInfo): CandidateOptions;
  /** Resolve a target as named by the merchant (and an optional heading qualifier) to the page's controls. */
  resolve(target: string, heading?: string): Resolution;
  /** All visible and hidden control names (normalised), for reporting. */
  hasSummaries: boolean;
}

export type Resolution = { kind: "group"; group: Group } | { kind: "unusable"; label: string } | { kind: "none" };

const KIND_ORDER: Group["kind"][] = ["label", "split", "clash", "field", "heading", "hidden", "short"];

/** wantsField: the target names a text field ("the search box"), so a field with that name is a target and buttons of the same name are not. */
export function buildControlIndex(pages: PageControls[], wantsField: boolean): ControlIndex {
  const visible = pages.flatMap((p) => p.controls);
  // A saved page keeps what a script shows later (slider buttons, popups) marked hidden. The generated script only reacts to real clicks,
  // so such a control is built like any other, but only when no visible control has its name; the plan says it was hidden when saved.
  const visibleNames = new Set(visible.map((c) => norm(controlLabel(c))));
  const shownLater = pages
    .flatMap((p) => p.hiddenControls ?? [])
    .filter((c) => {
      const label = controlLabel(c);
      const n = norm(label);
      return n.length >= 3 && !hasNonAsciiLetters(label) && !visibleNames.has(n) && !isFieldControl(c);
    })
    .map((c): ControlInfo => ({ ...c, hiddenAtSave: true }));
  const controls = [...visible, ...shownLater];
  // Controls that carry a class, for the "utility class" test.
  const byClass = new Map<string, ControlInfo[]>();
  for (const c of controls) for (const k of new Set(c.classes ?? [])) byClass.set(k, [...(byClass.get(k) ?? []), c]);
  const labelKey = (c: ControlInfo) => norm(controlLabel(c));
  const optionsFor = (c: ControlInfo): CandidateOptions => ({
    utility: (k) => {
      const own = labelKey(c);
      let others = 0;
      for (const o of byClass.get(k) ?? []) if (o !== c && labelKey(o) !== own && ++others > UTILITY_CLASS_MAX_OTHERS) return true;
      return false;
    },
  });

  // One entry per distinct SAME-KIND, SAME-RAW-LABEL set of controls (desktop and mobile copies are one event).
  interface Sub { label: string; field: boolean; plain: boolean; ctrls: ControlInfo[] }
  const subsByN = new Map<string, Map<string, Sub>>();
  const unusable = new Map<string, string>();
  const shortLabels = new Map<string, string>();
  for (const c of controls) {
    const label = controlLabel(c);
    if (label.length === 0) continue;
    const n = norm(label);
    if (n.length === 0 || hasNonAsciiLetters(label)) {
      unusable.set(label.toLowerCase(), label);
      continue;
    }
    if (n.length < 3) {
      // Two-letter names ("Go", "OK") are too short to match reliably; named, they are reported (never matched, never dropped).
      if (n.length === 2) shortLabels.set(n, label);
      continue;
    }
    const raw = fold(label).toLowerCase().replace(/\s+/g, " ").trim();
    const field = isFieldControl(c);
    const key = `${field ? "f" : "a"}|${raw}`;
    const subs = subsByN.get(n) ?? new Map<string, Sub>();
    const sub = subs.get(key) ?? { label, field, plain: raw === n, ctrls: [] };
    sub.ctrls.push(c);
    subs.set(key, sub);
    subsByN.set(n, subs);
  }
  const labelGroups = new Map<string, { label: string; ctrls: ControlInfo[]; loose: boolean; skipped: string[] }>();
  const sideGroups: Group[] = [];
  for (const [n, subsMap] of subsByN) {
    const subs = [...subsMap.values()];
    const fields = subs.filter((x) => x.field);
    let pool = subs.filter((x) => !x.field);
    if (wantsField && fields.length > 0) pool = fields;
    if (pool.length === 0) {
      // Only text fields carry this name and the target did not say field: reported, never built.
      sideGroups.push({ n, key: `field:${n}`, label: fields[0]!.label, ctrls: [], kind: "field" });
      continue;
    }
    const plain = pool.filter((x) => x.plain);
    const use = plain.length > 0 ? plain : pool;
    if (use.length > 1) {
      sideGroups.push({ n, key: `clash:${n}`, label: use[0]!.label, ctrls: use.flatMap((x) => x.ctrls), kind: "clash", options: use.map((x) => x.label) });
      continue;
    }
    const chosen = use[0]!;
    // A link with no href that shares its label with a link that has one is the dropdown opener, not the link.
    const isBare = (c: ControlInfo) => c.tag === "a" && !c.href && !c.role && !c.data?.target && !chosen.field;
    const hasLink = chosen.ctrls.some((c) => c.tag === "a" && !!c.href);
    const bare = hasLink ? chosen.ctrls.filter(isBare) : [];
    const kept = bare.length > 0 ? chosen.ctrls.filter((c) => !isBare(c)) : chosen.ctrls;
    const skipped = bare.length > 0 ? [`"${safeLabel(chosen.label)}": the page also has ${bare.length === 1 ? "a menu item" : `${bare.length} menu items`} with this name and no link address (a dropdown opener); only the one that links to a page is tracked`] : [];
    labelGroups.set(n, { label: chosen.label, ctrls: kept, loose: !chosen.plain, skipped });
  }
  const groups: Group[] = [];
  const headingCtrls = new Map<string, { heading: string; ctrls: ControlInfo[] }>();
  for (const [n, lg] of labelGroups) {
    // Distinct headings under this label, in page order.
    const headings = new Map<string, string>();
    for (const c of lg.ctrls) {
      const h = headingOf(c);
      const hn = norm(h);
      if (hn.length >= 3 && !hasNonAsciiLetters(h) && !headings.has(hn)) headings.set(hn, h);
    }
    const split = headings.size >= 2;
    const generic = split || GENERIC_LABELS.has(n);
    const extra = { ...(lg.loose ? { loose: true } : {}), ...(lg.skipped.length > 0 ? { skipped: lg.skipped } : {}) };
    groups.push(split ? { n, key: `split:${n}`, label: lg.label, ctrls: lg.ctrls, kind: "split", options: [...headings.values()], ...extra } : { n, key: `label:${n}`, label: lg.label, ctrls: lg.ctrls, kind: "label", ...extra });
    if (!generic) continue;
    for (const [hn, h] of headings) {
      const ctrls = lg.ctrls.filter((c) => norm(headingOf(c)) === hn);
      groups.push({ n: `${n} ${hn}`, key: `pair:${n}:${hn}`, label: `${lg.label} under ${h}`, ctrls, kind: "pair", heading: h, base: lg.label, labelN: n, headingN: hn, ...extra });
      const hc = headingCtrls.get(hn) ?? { heading: h, ctrls: [] };
      hc.ctrls.push(...ctrls);
      headingCtrls.set(hn, hc);
    }
  }
  // A generic button can also be named by its heading, unless some control already carries that exact text as its own label.
  for (const [hn, hc] of headingCtrls) {
    if (labelGroups.has(hn)) continue;
    const labels = new Map<string, string>();
    for (const c of hc.ctrls) labels.set(norm(controlLabel(c)), controlLabel(c));
    groups.push({ n: hn, key: `heading:${hn}`, label: hc.heading, ctrls: hc.ctrls, kind: "heading", heading: hc.heading, options: labels.size >= 2 ? [...labels.values()] : undefined });
  }
  groups.push(...sideGroups);
  // Controls that exist only as hidden or too-short names: reported with the true reason, never "not found".
  const hiddenLabels = new Map<string, string>();
  for (const c of pages.flatMap((p) => p.hiddenControls ?? [])) {
    const label = controlLabel(c);
    const n = norm(label);
    if (n.length < 2 || hasNonAsciiLetters(label) || subsByN.has(n) || shortLabels.has(n)) continue;
    hiddenLabels.set(n, label);
  }
  for (const [n, label] of hiddenLabels) groups.push({ n, key: `hidden:${n}`, label, ctrls: [], kind: "hidden" });
  for (const [n, label] of shortLabels) if (!hiddenLabels.has(n)) groups.push({ n, key: `short:${n}`, label, ctrls: [], kind: "short" });

  const byN = new Map<string, Group[]>();
  const pairs = new Map<string, Group>();
  for (const g of groups) {
    if (g.kind === "pair") pairs.set(`${g.labelN}|${g.headingN}`, g);
    else byN.set(g.n, [...(byN.get(g.n) ?? []), g]);
  }
  const labelOnly = new Map<string, Group>();
  for (const g of groups) if (g.kind === "label" || g.kind === "split") labelOnly.set(g.n, g);

  return {
    controls,
    unusable,
    optionsFor,
    hasSummaries: controls.some((c) => c.tag === "summary"),
    resolve(target, heading) {
      const n = norm(target);
      if (n.length === 0) {
        const low = target.trim().toLowerCase();
        const label = low.length > 0 ? unusable.get(low) : undefined;
        return label !== undefined ? { kind: "unusable", label } : { kind: "none" };
      }
      const hn = heading !== undefined ? norm(heading) : "";
      if (hn.length > 0) {
        const pair = pairs.get(`${n}|${hn}`);
        if (pair) return { kind: "group", group: pair };
        // A plain label whose controls all sit under that heading: the qualifier is consistent, so it is the label group.
        const only = labelOnly.get(n);
        if (only && only.kind === "label" && only.ctrls.length > 0 && only.ctrls.every((c) => norm(headingOf(c)) === hn)) return { kind: "group", group: only };
        return { kind: "none" };
      }
      const candidates = byN.get(n);
      if (!candidates) {
        // No control has exactly this name. A model often adds the control's type after it ("Claim Free Session button"): accept the ONE
        // control whose whole name (6+ characters) starts the target, with at most two words after it, longest name first. Words BEFORE
        // the name are never accepted ("Claim Free Session" must not turn into the different "Free Session"). Anything unclear stays "none".
        const hits = groups.filter((g) => {
          if (g.kind !== "label" || g.ctrls.length === 0 || g.n.length < 6 || !n.startsWith(`${g.n} `)) return false;
          const extra = n.slice(g.n.length).trim();
          // The extra words must not be another control's own name ("Free Trial Sign Up" is not "Free Trial" plus a spare word when "Sign Up" is a button).
          // ...and must not themselves say hover or typing ("Careers hover menu" is not a click on Careers).
          return extra.split(" ").length <= 2 && !byN.has(extra) && !NOT_A_CLICK.some((r) => r.pattern.test(extra));
        });
        const longest = Math.max(0, ...hits.map((g) => g.n.length));
        const best = hits.filter((g) => g.n.length === longest);
        return best.length === 1 ? { kind: "group", group: { ...best[0]!, looseWords: true } } : { kind: "none" };
      }
      for (const kind of KIND_ORDER) {
        const g = candidates.find((x) => x.kind === kind);
        if (g) return { kind: "group", group: g };
      }
      return { kind: "none" };
    },
  };
}
