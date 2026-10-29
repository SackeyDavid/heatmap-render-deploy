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
  return r.includes(e);
}

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
