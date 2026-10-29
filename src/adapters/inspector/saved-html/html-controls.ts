// Bounded, linear-time extraction of a title and the interactive controls from saved HTML.
//
// This is NOT a spec-complete HTML parser. It is a hand-written tokenizer with a small element stack, built for one job:
// list what a visitor could click or change on a page, from markup we do not control. Properties it keeps on purpose:
//   - one forward pass; every `indexOf` moves the cursor forward, so work is O(input) (plus O(maxDepth) bounded scans);
//   - no regular expression with nested or unbounded repetition over input (every regex is a single class with `+`, or has
//     bounded quantifiers);
//   - hard limits instead of silent partial results: nesting deeper than `maxDepth` throws, controls past `maxControls`
//     set an explicit truncation flag and keep counting.
//
// Rules (also stated in the adapter's report):
//   - script, style, textarea and noscript content is skipped (raw-text jump); template content is skipped (markup is
//     tracked so its end tag is found); inline <svg>/<math> subtrees yield no controls and no text.
//   - NOT rendered, so not reported: elements with the `hidden` attribute, inline `display:none` / `visibility:hidden`,
//     <input type=hidden>, and everything inside such an element.
//   - hidden controls are not click targets, but they are REMEMBERED (`hiddenControls`, label only, capped): a request that names one
//     is told it is hidden on the saved page instead of "not found" or "English only".
//   - an <img alt="..."> inside a control that has no text and no aria-label is that control's label (icon buttons); so is the alt of
//     <input type=image> when it has no value.
//   - aria-hidden="true" is still rendered: the control is kept and flagged `ariaHidden: true`.
//   - controls: button, select, summary, textarea, a, input (not hidden), role in INTERACTIVE_ROLES, elements with an
//     onclick attribute or a tabindex >= 0, and "labelled widgets" (aria-label plus a data-* attribute or a class token such
//     as btn/button/card/tab/toggle/trigger/play/swatch/tile).
//   - all text that leaves this module (title, text, ariaLabel, class tokens, data values, href, heading) is sanitised and capped.
//   - `heading` (additive): the text of the nearest PRECEDING heading element (h1-h6) in document order that belongs to the
//     control's container. Precisely: look at the control's 12 nearest ancestors, parent first; the first one that has a heading
//     before the control gives it (the LAST heading that closed inside that ancestor before the control starts). A heading
//     that sits inside an element that also contains a control (a "card": heading + its buttons) belongs to that element only
//     and is not visible to anything outside it; a heading inside a wrapper with no control (<div class=title><h3>..</h3></div>)
//     is visible to the wrapper's parent. Headings that are hidden, inside <template>, <svg>, or inside a control, do not
//     count. No heading in reach: `heading` is left unset. Text is sanitised, tags stripped, capped at 80 characters.
//   - `ancestorId` (additive): the sanitised id of the control's DIRECT parent element, when it has one (not an ancestor further up:
//     the builder turns it into `#<id> > <tag>`, which is only exact for a direct child).

import type { ControlInfo } from "../../../domain/types.ts";

export interface ExtractOptions {
  /** Maximum controls kept (default 500). More are counted and flagged, not kept. */
  maxControls?: number;
  /** Maximum element nesting (default 2000). Deeper markup throws a plain error. */
  maxDepth?: number;
}

export interface Extracted {
  title: string;
  controls: ControlInfo[];
  /** Controls found, including those dropped by the cap. */
  totalControls: number;
  truncated: boolean;
  /** Controls that exist in the markup but are hidden (hidden attribute, display:none, visibility:hidden, or inside such an element). Label and tag only matter; capped at MAX_HIDDEN_CONTROLS. */
  hiddenControls: ControlInfo[];
}

/** How many hidden controls are remembered per page. */
export const MAX_HIDDEN_CONTROLS = 100;

export const DEFAULT_MAX_CONTROLS = 500;
export const DEFAULT_MAX_DEPTH = 2000;

const TEXT_CAP = 160;
const LABEL_CAP = 200;
const ID_CAP = 128;
const CLASS_TOKEN_CAP = 64;
const MAX_CLASS_TOKENS = 12;
const HREF_CAP = 300;
const DATA_CAP = 120;
const MAX_DATA_ATTRS = 8;
const TITLE_CAP = 300;
const HEADING_CAP = 80;
const HEADING_BUFFER_CAP = 600;
/** How many ancestors (parent first) are searched for a preceding heading. */
export const HEADING_ANCESTOR_LEVELS = 12;
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const ATTR_STORE_CAP = 4096;
const RAW_TEXT_BUDGET = 1200;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "noscript", "title"]);
const FOREIGN = new Set(["svg", "math"]);
const CONTROL_TAGS = new Set(["button", "select", "summary", "textarea", "a", "input"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "checkbox", "radio", "switch", "option", "combobox", "textbox", "searchbox", "slider", "spinbutton", "treeitem"]);
const WIDGET_CLASS = /(?:^|[-_])(?:btn|button|card|tab|toggle|trigger|play|swatch|tile)(?:[-_]|$)/i;
const BUTTON_LIKE_INPUT = new Set(["submit", "button", "reset", "image"]);
const WANTED_ATTRS = new Set(["id", "class", "aria-label", "role", "type", "name", "value", "href", "tabindex", "hidden", "aria-hidden", "style", "onclick", "alt"]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "\u00a9", reg: "\u00ae", trade: "\u2122", hellip: "\u2026",
  mdash: "\u2014", ndash: "\u2013", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", bull: "\u2022", middot: "\u00b7",
  euro: "\u20ac", pound: "\u00a3", yen: "\u00a5", cent: "\u00a2", times: "\u00d7", laquo: "\u00ab", raquo: "\u00bb", deg: "\u00b0",
  rarr: "\u2192", larr: "\u2190", check: "\u2713", star: "\u2606", hearts: "\u2665",
};

/** Decodes numeric and a small set of named entities. Unknown or malformed ones are left as written. */
export function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (whole, hex?: string, dec?: string, name?: string) => {
    if (name !== undefined) return NAMED[name] ?? NAMED[name.toLowerCase()] ?? whole;
    const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec!, 10);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "\ufffd";
    return String.fromCodePoint(cp);
  });
}

const SPACES = /[\t\n\r\f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
const INVISIBLE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e0fff}]/gu;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * Makes untrusted page text safe to carry into prompts and JSON: strips control, bidi, zero-width, invisible filler,
 * variation-selector and Unicode tag characters (and lone surrogates), turns every kind of whitespace into one space,
 * trims, and caps the length (never splitting a surrogate pair).
 */
export function sanitizeText(input: string, max: number): string {
  // Bound the work first: nothing past 4x the cap can survive, and whitespace collapse only shrinks.
  let s = input.length > max * 4 + 64 ? input.slice(0, max * 4 + 64) : input;
  s = s.replace(SPACES, " ").replace(INVISIBLE, "").replace(LONE_SURROGATE, "");
  s = s.replace(/ {2,}/g, " ").trim();
  if (s.length > max) {
    s = s.slice(0, max);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s;
}

const clean = (raw: string, max: number) => sanitizeText(decodeEntities(raw), max);

const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

interface Tag {
  name: string;
  attrs: Record<string, string>;
  data: [string, string][];
  selfClosing: boolean;
  /** Index just past the closing '>'. */
  end: number;
  /** False when input ended inside the tag (unterminated quote or no '>'). */
  complete: boolean;
}

/** Parses a start tag at html[start] === '<'. Never scans backwards; every loop advances i. */
function parseStartTag(html: string, start: number): Tag {
  const n = html.length;
  let i = start + 1;
  while (i < n) {
    const c = html.charCodeAt(i);
    if (isSpace(c) || c === 47 || c === 62) break;
    i++;
  }
  const name = html.slice(start + 1, Math.min(i, start + 1 + 64)).toLowerCase();
  const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
  const data: [string, string][] = [];
  let seen = 0;
  let selfClosing = false;
  while (i < n) {
    const c = html.charCodeAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 62) return { name, attrs, data, selfClosing, end: i + 1, complete: true };
    if (c === 47) {
      if (html.charCodeAt(i + 1) === 62) selfClosing = true;
      i++;
      continue;
    }
    // attribute name (a leading '=' is taken as part of the name, as browsers do)
    const nameStart = i;
    i++;
    while (i < n) {
      const d = html.charCodeAt(i);
      if (isSpace(d) || d === 61 || d === 62 || d === 47) break;
      i++;
    }
    const attrName = html.slice(nameStart, Math.min(i, nameStart + 80)).toLowerCase();
    while (i < n && isSpace(html.charCodeAt(i))) i++;
    let value = "";
    if (html.charCodeAt(i) === 61) {
      i++;
      while (i < n && isSpace(html.charCodeAt(i))) i++;
      const q = html.charCodeAt(i);
      if (q === 34 || q === 39) {
        const close = html.indexOf(q === 34 ? '"' : "'", i + 1);
        if (close < 0) return { name, attrs, data, selfClosing, end: n, complete: false };
        value = html.slice(i + 1, Math.min(close, i + 1 + ATTR_STORE_CAP));
        i = close + 1;
      } else {
        const vs = i;
        while (i < n) {
          const d = html.charCodeAt(i);
          if (isSpace(d) || d === 62) break;
          i++;
        }
        value = html.slice(vs, Math.min(i, vs + ATTR_STORE_CAP));
      }
    }
    seen++;
    if (seen > 200) continue; // keep scanning to find '>', stop storing
    if (WANTED_ATTRS.has(attrName)) {
      if (!(attrName in attrs)) attrs[attrName] = value; // first occurrence wins, as in HTML
    } else if (attrName.startsWith("data-") && attrName.length > 5 && data.length < MAX_DATA_ATTRS * 4) {
      data.push([attrName.slice(5), value]);
    }
  }
  return { name, attrs, data, selfClosing, end: n, complete: false };
}

/** Index of the "</name" that closes a raw-text element, or html.length. Case-insensitive, forward only. */
function findRawEnd(html: string, from: number, name: string): number {
  let p = html.indexOf("</", from);
  while (p >= 0) {
    if (html.substr(p + 2, name.length).toLowerCase() === name) {
      const after = html.charCodeAt(p + 2 + name.length);
      if (Number.isNaN(after) || isSpace(after) || after === 47 || after === 62) return p;
    }
    p = html.indexOf("</", p + 2);
  }
  return html.length;
}

interface Ctl {
  info: ControlInfo;
  raw: string;
  /** Text of <img alt> inside the control: its label only when the control has no text of its own. */
  alt: string;
  /** The control is hidden: remembered for messages, never a click target. */
  hiddenCtl: boolean;
}

interface Entry {
  name: string;
  hidden: boolean;
  ariaHidden: boolean;
  foreign: boolean;
  skip: boolean;
  ctl?: Ctl;
  /** The element's own id, sanitised (set only when it has one); the direct child control reports it as `ancestorId`. */
  id?: string;
  /** This element is, or contains, a control. */
  hasCtl: boolean;
  /** Text of the last heading that closed inside this element and is visible to controls that follow in it. */
  heading?: string;
  /** Set on a countable heading element: its text so far. */
  headBuf?: string;
}

/** Heading text for output: tags and invisible characters removed, whitespace collapsed, capped. */
function headingText(raw: string): string {
  return sanitizeText(raw.replace(SPACES, " ").replace(/<[^<>]{0,200}>/g, " "), HEADING_CAP);
}

/** The heading visible to a control that is about to start: the first of its nearest ancestors (parent first) that has one. */
function nearestHeading(stack: Entry[]): string | undefined {
  for (let k = stack.length - 1, levels = 0; k >= 0 && levels < HEADING_ANCESTOR_LEVELS; k--, levels++) {
    const h = stack[k]!.heading;
    if (h !== undefined) return h;
  }
  return undefined;
}

const isHiddenStyle = (style: string | undefined): boolean => {
  if (!style) return false;
  const s = style.slice(0, 512).toLowerCase().replace(/\s+/g, "");
  return s.includes("display:none") || s.includes("visibility:hidden");
};

function classify(tag: Tag, foreign: boolean): boolean {
  if (foreign) return false;
  const a = tag.attrs;
  if (tag.name === "input") return (a.type ?? "").trim().toLowerCase() !== "hidden";
  if (CONTROL_TAGS.has(tag.name)) return true;
  if ("role" in a && INTERACTIVE_ROLES.has((a.role ?? "").trim().toLowerCase().split(/\s+/, 1)[0] ?? "")) return true;
  if ("onclick" in a) return true;
  if ("tabindex" in a) {
    const t = parseInt(a.tabindex ?? "", 10);
    if (Number.isFinite(t) && t >= 0) return true;
  }
  if ((a["aria-label"] ?? "").trim() !== "") {
    if (tag.data.length > 0) return true;
    for (const token of (a.class ?? "").slice(0, 512).split(/\s+/)) if (token.length <= 64 && WIDGET_CLASS.test(token)) return true;
  }
  return false;
}

function buildInfo(tag: Tag, ariaHidden: boolean, heading: string | undefined, parentId: string | undefined): Ctl {
  const a = tag.attrs;
  const info: ControlInfo = { tag: tag.name, text: "" };
  const id = a.id !== undefined ? clean(a.id, ID_CAP) : "";
  if (id) info.id = id;
  const label = a["aria-label"] !== undefined ? clean(a["aria-label"], LABEL_CAP) : "";
  if (label) info.ariaLabel = label;
  const classes = (a.class ?? "")
    .slice(0, 1024)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_CLASS_TOKENS)
    .map((t) => clean(t, CLASS_TOKEN_CAP))
    .filter(Boolean);
  if (classes.length > 0) info.classes = classes;
  const role = a.role !== undefined ? clean(a.role, 32).toLowerCase() : "";
  if (role) info.role = role;
  const type = a.type !== undefined ? clean(a.type, 24).toLowerCase() : "";
  if (type) info.type = type;
  const name = a.name !== undefined ? clean(a.name, 64) : "";
  if (name) info.name = name;
  const href = a.href !== undefined ? clean(a.href, HREF_CAP) : "";
  if (href) info.href = href;
  const data: Record<string, string> = {};
  let kept = 0;
  for (const [k, v] of tag.data) {
    if (kept >= MAX_DATA_ATTRS) break;
    const key = clean(k, 48).toLowerCase();
    if (!key || key in data) continue;
    data[key] = clean(v, DATA_CAP);
    kept++;
  }
  if (kept > 0) info.data = data;
  if (ariaHidden) info.ariaHidden = true;
  if (heading) info.heading = heading;
  if (parentId) info.ancestorId = parentId;
  const raw = tag.name === "input" && BUTTON_LIKE_INPUT.has(type) ? (a.value !== undefined ? clean(a.value, TEXT_CAP) : type === "image" && a.alt !== undefined ? clean(a.alt, TEXT_CAP) : "") : "";
  return { info, raw, alt: "", hiddenCtl: false };
}

export function extractFromHtml(html: string, opts: ExtractOptions = {}): Extracted {
  const maxControls = opts.maxControls ?? DEFAULT_MAX_CONTROLS;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const n = html.length;
  const stack: Entry[] = [];
  const counts = new Map<string, number>();
  const kept: Ctl[] = [];
  const hiddenKept: Ctl[] = [];
  let total = 0;
  let title: string | undefined;
  let i = 0;

  const top = (): Entry | undefined => stack[stack.length - 1];
  const ctlStack: Ctl[] = [];
  const innermostCtl = (): Ctl | undefined => ctlStack[ctlStack.length - 1];

  let openHeadings = 0;
  const pop = () => {
    const e = stack.pop()!;
    counts.set(e.name, (counts.get(e.name) ?? 1) - 1);
    if (e.ctl) ctlStack.pop();
    const up = stack[stack.length - 1];
    if (e.headBuf !== undefined) {
      openHeadings--;
      // A heading that holds a control is that control's label, not a section title.
      const text = e.hasCtl ? "" : headingText(e.headBuf);
      if (up && text) up.heading = text;
    } else if (up && e.heading !== undefined && !e.hasCtl) {
      up.heading = e.heading; // a wrapper around a heading, with no control in it: the heading is visible to its parent
    }
    if (up && e.hasCtl) up.hasCtl = true;
    if (e.ctl && e.ctl.raw && !e.ctl.hiddenCtl) {
      const parent = innermostCtl();
      if (parent && parent.raw.length < RAW_TEXT_BUDGET) parent.raw = `${parent.raw} ${e.ctl.raw}`.slice(0, RAW_TEXT_BUDGET);
    }
  };

  const closeTo = (name: string) => {
    if ((counts.get(name) ?? 0) <= 0) return;
    while (stack.length > 0) {
      const closed = stack[stack.length - 1]!;
      pop();
      if (closed.name === name) return;
    }
  };

  const impliedClose = (name: string) => {
    const t = top();
    if (!t) return;
    if (name === "li") {
      for (let k = stack.length - 1, steps = 0; k >= 0 && steps < 8; k--, steps++) {
        const e = stack[k]!;
        if (e.name === "ul" || e.name === "ol") return;
        if (e.name === "li") {
          while (stack.length > k) pop();
          return;
        }
      }
    } else if (name === "p" || name === "option" || name === "dt" || name === "dd" || name === "tr" || name === "td" || name === "th") {
      const same = name === "dt" || name === "dd" ? t.name === "dt" || t.name === "dd" : name === "td" || name === "th" ? t.name === "td" || t.name === "th" : t.name === name;
      if (same) pop();
    }
  };

  const addText = (from: number, to: number) => {
    const t = top();
    if (!t || t.skip || t.foreign) return;
    if (t.hidden) {
      // Hidden text is never visible text, except the label of a hidden control (kept only to name it in a message).
      const hc = innermostCtl();
      if (hc?.hiddenCtl && hc.raw.length < RAW_TEXT_BUDGET && hc.info.tag !== "select") hc.raw = `${hc.raw}${decodeEntities(html.slice(from, Math.min(to, from + 2000))).replace(SPACES, " ")}`.slice(0, RAW_TEXT_BUDGET);
      return;
    }
    if (openHeadings > 0) {
      for (let k = stack.length - 1; k >= 0; k--) {
        const h = stack[k]!;
        if (h.headBuf !== undefined) {
          if (h.headBuf.length < HEADING_BUFFER_CAP) h.headBuf += decodeEntities(html.slice(from, Math.min(to, from + 2000)));
          break;
        }
      }
    }
    const ctl = innermostCtl();
    if (!ctl || ctl.raw.length >= RAW_TEXT_BUDGET || ctl.info.tag === "select") return;
    const frag = decodeEntities(html.slice(from, Math.min(to, from + 2000))).replace(SPACES, " ");
    ctl.raw = `${ctl.raw}${frag}`.slice(0, RAW_TEXT_BUDGET);
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) addText(i, textEnd);
    if (lt < 0) break;
    const c = html.charCodeAt(lt + 1);

    if (c === 33 && html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (c === 33 || c === 63) {
      const end = html.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === 47) {
      if (!isLetter(html.charCodeAt(lt + 2))) {
        i = lt + 2;
        continue;
      }
      let j = lt + 2;
      while (j < n) {
        const d = html.charCodeAt(j);
        if (isSpace(d) || d === 47 || d === 62) break;
        j++;
      }
      const name = html.slice(lt + 2, Math.min(j, lt + 2 + 64)).toLowerCase();
      const end = html.indexOf(">", j);
      closeTo(name);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (!isLetter(c)) {
      i = lt + 1;
      continue;
    }

    const tag = parseStartTag(html, lt);
    i = tag.end;
    if (!tag.complete) continue; // input ended inside the tag; a browser drops it too
    const name = tag.name;
    impliedClose(name);

    if (RAW_TEXT.has(name)) {
      const t = top();
      const inForeign = !!t?.foreign;
      const endAt = findRawEnd(html, i, name);
      if (name === "title" && title === undefined && !inForeign && !(t?.skip)) title = clean(html.slice(i, Math.min(endAt, i + 4 * TITLE_CAP)), TITLE_CAP);
      i = endAt;
      continue;
    }

    const parent = top();
    const foreign = !!parent?.foreign || FOREIGN.has(name);
    const skip = !!parent?.skip || name === "template";
    const hidden = !!parent?.hidden || "hidden" in tag.attrs || isHiddenStyle(tag.attrs.style) || (name === "input" && (tag.attrs.type ?? "").trim().toLowerCase() === "hidden");
    const ariaHidden = !!parent?.ariaHidden || (tag.attrs["aria-hidden"] ?? "").trim().toLowerCase() === "true";

    const isControl = !skip && !hidden && classify(tag, foreign);
    let ctl: Ctl | undefined;
    if (isControl) {
      total++;
      if (kept.length < maxControls) {
        ctl = buildInfo(tag, ariaHidden, nearestHeading(stack), parent?.id);
        kept.push(ctl);
      }
    } else if (!skip && hidden && hiddenKept.length < MAX_HIDDEN_CONTROLS && classify(tag, foreign)) {
      ctl = buildInfo(tag, ariaHidden, undefined, undefined);
      ctl.hiddenCtl = true;
      hiddenKept.push(ctl);
    }
    if (name === "img") {
      // An icon button: <button><img alt="Open Cart"></button>. The alt of a visible image counts for the visible control it sits in
      // (a hidden image inside a visible control does not); a hidden control keeps the alt of the image inside it.
      const owner = innermostCtl();
      const alt = tag.attrs.alt !== undefined ? clean(tag.attrs.alt, TEXT_CAP) : "";
      if (owner && alt && !skip && !foreign && (owner.hiddenCtl || !hidden) && owner.alt.length < TEXT_CAP) owner.alt = `${owner.alt} ${alt}`.trim().slice(0, TEXT_CAP);
    }

    if (name === "textarea") {
      i = findRawEnd(html, i, name); // its content is user-editable text, not a label
      continue;
    }
    const selfContained = VOID.has(name) || (tag.selfClosing && foreign);
    if (selfContained) continue;
    if (stack.length >= maxDepth) {
      throw new Error(`The page's markup is nested more than ${maxDepth} levels deep, which is more than we read safely.`);
    }
    const countsAsHeading = HEADING_TAGS.has(name) && !skip && !foreign && !hidden && !isControl && !innermostCtl();
    if (countsAsHeading) openHeadings++;
    const ownId = tag.attrs.id !== undefined ? clean(tag.attrs.id, ID_CAP) : "";
    stack.push({ name, hidden, ariaHidden, foreign, skip, ctl, hasCtl: isControl, ...(ownId ? { id: ownId } : {}), ...(countsAsHeading ? { headBuf: "" } : {}) });
    if (ctl) ctlStack.push(ctl);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  while (stack.length > 0) pop();

  const finish = ({ info, raw, alt }: Ctl): ControlInfo => {
    const own = sanitizeText(raw, TEXT_CAP);
    info.text = own.length > 0 ? own : sanitizeText(alt, TEXT_CAP);
    return info;
  };
  const controls = kept.map(finish);
  return { title: title ?? "", controls, totalControls: total, truncated: total > controls.length, hiddenControls: hiddenKept.map(finish) };
}
