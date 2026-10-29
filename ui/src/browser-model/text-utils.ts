/** Browser copy of server text-utils (ui cannot import src/). Keep in sync via tests. */

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
  if (wanted.length < 2 || !wanted.some((w) => !FILLER_WORDS.has(w))) return false; // filler alone ("click on") proves nothing
  const have = tokens(request);
  for (let from = 0; from < have.length; from++) {
    if (have[from] !== wanted[0]) continue;
    let at = 1;
    let end = from;
    for (let i = from + 1; i < have.length && at < wanted.length; i++) if (have[i] === wanted[at]) (at++, (end = i));
    if (at < wanted.length) continue;
    if (!have.slice(Math.max(0, from - 3), end + 1).some((w) => NEGATIONS.has(w))) return true; // a skipped "never" or "not" would flip the meaning
  }
  return false;
}

/** Words that carry no target on their own. */
const FILLER_WORDS = new Set(["a", "an", "the", "on", "in", "at", "of", "to", "me", "my", "when", "if", "someone", "somebody", "visitor", "visitors", "click", "clicks", "clicked", "tap", "taps", "tapped", "press", "presses", "tell", "track", "and", "or", "is", "are", "i", "we", "they", "it"]);
/** A negation inside the matched stretch or just before it means the quoted words may be the opposite of what was asked. */
const NEGATIONS = new Set(["never", "not", "no", "dont", "don", "doesn", "without", "except", "ignore", "instead", "nor", "neither"]);

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
