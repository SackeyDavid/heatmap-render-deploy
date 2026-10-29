/** NFC + collapse whitespace for request matching (intake uses guardText separately). */
export function normalizeRequestText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Double quote marks carry no meaning for matching ("Claim free Session" and Claim free Session are the same words). */
const DOUBLE_QUOTES = /["\u201C\u201D\u201E\u00AB\u00BB]/g;
const withoutQuotes = (t: string) => normalizeRequestText(t.replace(DOUBLE_QUOTES, " "));

export function evidenceInRequest(evidence: string, request: string): boolean {
  const e = withoutQuotes(evidence).toLowerCase();
  const r = withoutQuotes(request).toLowerCase();
  if (!e || e.length > 160) return false;
  if (!e.split(/[^\p{L}\p{N}]+/u).some((w) => w && !FILLER_WORDS.has(w))) return false; // filler alone ("click on", "when someone") proves nothing
  return r.includes(e) || wordsInOrder(e, r);
}

/**
 * A list wish ("clicks on Search and Free Session") makes the model quote each item with the shared words ("clicks on Free Session").
 * That is still the merchant's own words, in the merchant's order, with some left out. Two words or more, so one stray word never counts.
 */
function wordsInOrder(evidence: string, request: string): boolean {
  const tokens = (t: string) => t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const wanted = tokens(evidence);
  const lead = wanted.findIndex((w) => !FILLER_WORDS.has(w));
  if (wanted.length < 2 || lead < 0) return false; // filler alone ("click on") proves nothing
  const prefix = wanted.slice(0, lead).map(stem);
  const name = wanted.slice(lead); // the control's own words: they must stand together, in the order written
  const sentences = request.replace(/\b(vs|etc|inc|ltd|mr|mrs|dr|approx)\./gi, "$1").replace(/\be\.g\./gi, "eg").replace(/\bi\.e\./gi, "ie").replace(/\b(?:do not|don['\u2019]?t) (?:forget|miss|overlook)\b/gi, "also").replace(/\.{2,}|\u2026/g, ",").replace(/\r?\n+/g, ", ").split(/(?<!(?:^|\s)\d{1,2})[.!?;]+(?=\s|$)/).filter((t) => tokens(t).length > 0);
  return sentences.some((sentence) => matchesIn(sentence));

  function matchesIn(sentence: string): boolean {
    const { have, seg, text } = segments(sentence);
    const negatedText = (t: string) => NEGATIONS_RE.test(t) || t.split(" ").some((w) => NEGATIONS.has(w));
    // A list item that is itself a "Skip" or "Cancel" button, after the verb, says nothing about the verb: only words before the verb count.
    const negatedBefore = (i: number) => negatedText(have.slice(0, i).filter((_, j) => seg[j] === seg[i]).join(" "));
    // "Clicks on Home and Shop, not Contact or Careers": a no in one part of the list covers the parts after it, until a "but" starts a new one.
    const negationRunReaches = (from: number, at: number) => {
      let running = false;
      for (let s = seg[from]! + 1; s < seg[at]!; s++) {
        const t = text[s] ?? "";
        if (runNegates(t)) running = true;
        else if (t.startsWith("but ") || t === "but") running = false;
      }
      const own = text[seg[at]!] ?? "";
      if (own === "but" || own.startsWith("but ")) running = false; // the name's own part starts with "but": a new item
      return running && prefix.length > 0;
    };
    for (let at = 0; at + name.length <= have.length; at++) {
      if (!name.every((w, k) => have[at + k] === w)) continue;
      // The leading words ("clicks on") may sit earlier in the same sentence, in order, with other items between ("clicks on Search and Free Session").
      let from = at;
      let k = prefix.length - 1;
      let last = at; // where the nearest leading word sits
      for (let i = at - 1; i >= 0 && i >= at - MAX_LOOKBACK && k >= 0; i--) if (stem(have[i]!) === prefix[k]) (k--, (from = i), k === prefix.length - 2 && (last = i));
      if (k >= 0) continue;
      // Between the verb and the name there may be other list items, but not another action ("clicks on Search and views of Free Session").
      if (prefix.length > 0 && have.slice(from + 1, at).some((w) => OTHER_ACTIONS.has(w) || CONDITION_WORDS.has(w))) continue; // from the verb itself, so "scrolls on Pricing" cannot lend its "on"
      // An action right after the name, in the same part of the sentence ("the Pricing page views"), is a different wish.
      const end = at + name.length;
      if (have.slice(end, end + 2).some((w, j) => seg[end + j] === seg[at + name.length - 1] && (OTHER_ACTIONS.has(w) || AFTER_NAME_TOPICS.has(w)))) continue;
      // A "never" or "not" in the same part of the sentence as the name, or as the leading verb, may flip the meaning.
      // Parts end at a comma and at "and", "or", "but", "then": "clicks on Search and Free Session, but not Wishlist" keeps Free Session.
      // The control's own name may hold such a word ("No Thanks", "Cancel Order"): only the other words of its part count, and the three words just before it ("anything but").
      const partWords = have.filter((_, j) => seg[j] === seg[at] && (j < at || j >= end));
      if (negationRunReaches(from, at) || negatedText(partWords.join(" ")) || NEGATIONS_RE.test(have.slice(Math.max(0, at - 3), at).join(" ")) || (prefix.length > 0 && negatedBefore(from))) continue;
      return true;
    }
    return false;
  }
}

/** The words of one sentence, with the number of the part (between commas and list words) each word belongs to, and each part's text. */
function segments(sentence: string): { have: string[]; seg: number[]; text: string[] } {
  const have: string[] = [];
  const seg: number[] = [];
  const text: string[] = [];
  let part = -1;
  const open = () => (part++, (text[part] = ""));
  open();
  for (const chunk of sentence.split(/[,:]/)) {
    for (const w of chunk.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      if (PART_BREAKS.has(w) && text[part] !== "") open();
      have.push(w);
      seg.push(part);
      text[part] = `${text[part]}${text[part] ? " " : ""}${w}`;
    }
    if (text[part] !== "") open();
  }
  return { have, seg, text };
}
/** Strong ways to say no, which also cover the list items after them. "Skip", "Cancel" and "Remove" are often button names, so they do not. */
const WEAK_NEGATIONS = new Set(["skip", "cancel", "remove", "drop", "stop", "forget", "deleted", "removed", "scrap", "omit", "bar"]);
const runNegates = (t: string) => NEGATIONS_RE.test(t) || t.split(" ").some((w) => NEGATIONS.has(w) && !WEAK_NEGATIONS.has(w));

/** Words that start a new item in a list. */
const PART_BREAKS = new Set(["and", "or", "but", "then", "plus", "also"]);
/** Ways to say no that take more than one word. */
const NEGATIONS_RE = /\b(leave out|other than|take out|out of scope|apart from|rather than|instead of|not including|anything but|everything but|nothing on|nothing for|save for|with the exception|leave \w+ out|leaving \w+ out|leaving out|leave \w+ alone|leave alone)\b/;

/** How far back in a sentence the leading words ("clicks on") may sit from the control's name. */
const MAX_LOOKBACK = 16;

/** "clicks" and "click" are the same word here. */
const stem = (w: string) => {
  let x = w;
  if (x.length > 4 && x.endsWith("sses")) x = x.slice(0, -2); // presses
  else if (x.length > 3 && x.endsWith("s") && !x.endsWith("ss")) x = x.slice(0, -1); // clicks
  else if (x.length > 4 && x.endsWith("ed")) x = x.slice(0, -2); // clicked, pressed
  else if (x.length > 5 && x.endsWith("ing")) x = x.slice(0, -3); // clicking, pressing
  if (x.length > 3 && x !== w && /([^aeiou])\1$/.test(x) && (w.endsWith("ed") || w.endsWith("ing"))) x = x.slice(0, -1); // tapped, tapping
  return x;
};

/** Words that carry no target on their own. */
const FILLER_WORDS = new Set(["a", "an", "the", "on", "in", "at", "of", "to", "me", "my", "when", "if", "someone", "somebody", "visitor", "visitors", "click", "clicks", "clicked", "clicking", "tapping", "pressing", "selecting", "tap", "taps", "tapped", "press", "presses", "pressed", "select", "selects", "selected", "choose", "chooses", "chose", "choosing", "tell", "track", "and", "or", "is", "are", "i", "we", "they", "it"]);
/** A negation inside the matched stretch or just before it means the quoted words may be the opposite of what was asked. */
const NEGATIONS = new Set(["never", "not", "no", "dont", "don", "doesn", "didn", "isn", "aren", "wasn", "weren", "won", "wouldn", "shouldn", "couldn", "cannot", "without", "except", "ignore", "instead", "nor", "neither", "skip", "stop", "cancel", "avoid", "exclude", "excluding", "forget", "drop", "remove", "unneeded", "minus", "removed", "deleted", "excluded", "besides", "scrap", "omit", "omitting", "ignoring", "skipping", "dropping", "removing", "sans", "bar"]);
/**
 * Words that start a different action or condition; they may not sit between a leading verb and the control it is said to govern.
 * Only the forms a sentence uses ("views of", "visits to"); the plain forms are also button names ("View Pricing", "Open Menu") and are not listed.
 */
const OTHER_ACTIONS = new Set(["views", "viewed", "visits", "visited", "submits", "submitted", "submissions", "watches", "watched", "opens", "opened", "plays", "played", "scrolls", "scrolled", "hovers", "types", "typing", "typed", "hover", "hovering", "hovered", "selects", "selected", "sees", "loads", "downloads", "adds", "starts", "finishes", "completes", "enters", "leaves", "closes", "scroll", "scrolling", "exits", "errors", "impressions", "type", "exit", "bounces"]);
/** Words that, right after a name, show the sentence is about something else than clicks on it ("Cart abandonment", "the Cart view"). */
const AFTER_NAME_TOPICS = new Set(["view", "abandonment", "conversion", "conversions", "usage", "traffic", "rate", "errors", "impressions"]);
/** Words that start a new condition; between a leading verb and a name they end the list ("clicks on Search, and when someone submits Free Session"). */
const CONDITION_WORDS = new Set(["when", "whenever", "who", "that", "which", "if", "after", "before", "while"]);

const GENERIC_NOUNS = new Set([
  "page",
  "site",
  "store",
  "shop",
  "visitor",
  "visitors",
  "someone",
  "user",
  "users",
  "customer",
  "customers",
  "shopper",
  "shoppers",
  "they",
  "them",
  "button",
  "link",
  "element",
  "item",
  "video",
  "form",
  "field",
  "tab",
  "section",
  "area",
]);

const OCCURRENCE_WORDS = new Set([
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "every",
  "each",
  "unique",
  "once",
  "one",
  "two",
  "three",
  "four",
  "five",
]);

export function stemWord(w: string): string {
  const suffixes = ["ing", "ion", "ed", "es", "or", "er", "s"];
  for (const s of suffixes) {
    if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length);
  }
  return w;
}

export function contentTokens(phrase: string): string[] {
  const words = phrase
    .normalize("NFC")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const st = stemWord(w);
    if (GENERIC_NOUNS.has(w) || GENERIC_NOUNS.has(st)) continue;
    if (OCCURRENCE_WORDS.has(w)) continue;
    out.push(st);
  }
  return [...new Set(out)];
}

export function requestWordSet(request: string): Set<string> {
  const words = normalizeRequestText(request)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const set = new Set<string>();
  for (const w of words) {
    set.add(w);
    set.add(stemWord(w));
  }
  return set;
}

export function targetTokensSubsetOfRequest(target: string | undefined, request: string): boolean {
  if (!target) return true;
  const tokens = contentTokens(target);
  if (tokens.length === 0) return true;
  const req = requestWordSet(request);
  return tokens.every((t) => req.has(t));
}

export const NAME_VOCAB = new Set([
  "clicked",
  "opened",
  "started",
  "submitted",
  "abandoned",
  "scrolled",
  "played",
  "watched",
  "switched",
  "percent",
]);

export function nameHintAllowed(nameHint: string, request: string, behaviourTarget?: string): boolean {
  const parts = nameHint.split("_").filter(Boolean);
  const req = requestWordSet(request);
  const targetTokens = behaviourTarget ? contentTokens(behaviourTarget) : [];
  let shared = false;
  for (const p of parts) {
    if (NAME_VOCAB.has(p)) continue;
    if (/^\d+$/.test(p)) continue;
    if (!req.has(p) && !req.has(stemWord(p))) return false;
    if (targetTokens.includes(p) || targetTokens.includes(stemWord(p))) shared = true;
  }
  if (targetTokens.length > 0 && !shared) {
    for (const t of targetTokens) {
      if (parts.includes(t)) shared = true;
    }
  }
  return parts.length === 0 || shared || targetTokens.length === 0;
}
