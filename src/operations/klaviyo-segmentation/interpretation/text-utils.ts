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
  const sentences = request.replace(/\.{2,}|\u2026/g, ",").split(/[.!?;\n]+(?=\s|$)/).map(tokens).filter((t) => t.length > 0);
  return sentences.some((have) => matchesIn(have));

  function matchesIn(have: string[]): boolean {
    for (let at = 0; at + name.length <= have.length; at++) {
      if (!name.every((w, k) => have[at + k] === w)) continue;
      // The leading words ("clicks on") may sit earlier in the same sentence, in order, with other items between ("clicks on Search and Free Session").
      let from = at;
      let k = prefix.length - 1;
      let last = at; // where the nearest leading word sits
      for (let i = at - 1; i >= 0 && i >= at - MAX_LOOKBACK && k >= 0; i--) if (stem(have[i]!) === prefix[k]) (k--, (from = i), k === prefix.length - 2 && (last = i));
      if (k >= 0) continue;
      // Between the verb and the name there may be other list items, but not another action ("clicks on Search and views of Free Session").
      if (prefix.length > 0 && have.slice(last + 1, at).some((w) => OTHER_ACTIONS.has(w) || CONDITION_WORDS.has(w))) continue;
      const after = have.slice(at + name.length, at + name.length + 3);
      const around = [...have.slice(Math.max(0, from - 8), at + name.length), ...after];
      if (!around.some((w) => NEGATIONS.has(w)) && !followedByAnotherAction(after)) return true; // a "never" or "not" next to the name may flip the meaning
    }
    return false;
  }
}

/** "Pricing page views": an action right after the name. A list connector first ("Checkout and typing in the box") starts a new item, so it does not count. */
function followedByAnotherAction(after: string[]): boolean {
  const [first, second] = after;
  if (first !== undefined && OTHER_ACTIONS.has(first)) return true;
  return first !== undefined && !LIST_CONNECTORS.has(first) && second !== undefined && OTHER_ACTIONS.has(second);
}
const LIST_CONNECTORS = new Set(["and", "or", "then", "also", "plus", "but"]);

/** How far back in a sentence the leading words ("clicks on") may sit from the control's name. */
const MAX_LOOKBACK = 10;

/** "clicks" and "click" are the same word here. */
const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

/** Words that carry no target on their own. */
const FILLER_WORDS = new Set(["a", "an", "the", "on", "in", "at", "of", "to", "me", "my", "when", "if", "someone", "somebody", "visitor", "visitors", "click", "clicks", "clicked", "tap", "taps", "tapped", "press", "presses", "tell", "track", "and", "or", "is", "are", "i", "we", "they", "it"]);
/** A negation inside the matched stretch or just before it means the quoted words may be the opposite of what was asked. */
const NEGATIONS = new Set(["never", "not", "no", "dont", "don", "doesn", "didn", "isn", "aren", "wasn", "weren", "won", "wouldn", "shouldn", "couldn", "cannot", "without", "except", "ignore", "instead", "nor", "neither", "skip", "stop", "cancel", "avoid", "exclude", "excluding", "forget", "drop", "remove", "unneeded", "minus", "removed", "deleted", "excluded"]);
/**
 * Words that start a different action or condition; they may not sit between a leading verb and the control it is said to govern.
 * Only the forms a sentence uses ("views of", "visits to"); the plain forms are also button names ("View Pricing", "Open Menu") and are not listed.
 */
const OTHER_ACTIONS = new Set(["views", "viewed", "visits", "visited", "submits", "submitted", "submissions", "watches", "watched", "opens", "opened", "plays", "played", "scrolls", "scrolled", "hovers", "types", "typing", "typed", "hover", "hovering", "hovered", "selects", "selected", "sees", "loads", "downloads", "adds", "starts", "finishes", "completes", "enters", "leaves", "closes"]);
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
