/**
 * Text taken from a saved page (labels, headings) is untrusted: it can hold markup, control characters or be enormous.
 * Before it goes into a message a merchant reads, it is reduced to letters, digits, spaces and a few plain punctuation marks,
 * with tags removed, whitespace collapsed and the length capped.
 */

/** Longest label shown inside a message. */
export const MAX_SHOWN_LABEL = 60;
/** At most this many labels are listed in one message; the rest are counted. */
export const MAX_SHOWN_LABELS = 5;
/** A merchant-facing question is never longer than this. */
export const MAX_QUESTION_CHARS = 300;

// No ':' '/' '@': with them a page text could carry a clickable address or a handle into a message in the product's voice.
const ALLOWED = /[^\p{L}\p{N} .,'&()!?+%#_-]/gu;
const ADDRESS = /\b(?:[a-z][a-z0-9+.-]{1,10}:\/\/|www\.)\S*/gi;

export function safeLabel(raw: string, max: number = MAX_SHOWN_LABEL): string {
  const bounded = raw.length > 2000 ? raw.slice(0, 2000) : raw;
  let s = bounded.replace(/<[^<>]{0,500}>/g, " "); // whole tags, attributes included
  s = s.replace(ADDRESS, " ").replace(/[<>]/g, " ").replace(ALLOWED, " ");
  // A bare address (evil.example) is not a link to a person reading it, but many chat and mail tools make it one: a dot between
  // letters becomes a space. Quotes survive only as an apostrophe inside a word (Women's); "&" only between spaces.
  s = s.replace(/(?<=[\p{L}\p{N}])\.(?=\p{L})/gu, " ").replace(/(?<!\p{L})'|'(?!\p{L})/gu, " ").replace(/&(?=\S)|(?<=\S)&/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = `${s.slice(0, max - 3).trimEnd()}...`;
  return s;
}

/** "A, B and C", at most MAX_SHOWN_LABELS of them, each safe; empty labels are dropped. */
export function listLabels(raws: string[], maxLabels: number = MAX_SHOWN_LABELS, width: number = MAX_SHOWN_LABEL): string {
  const clean = [...new Set(raws.map((r) => safeLabel(r, width)).filter((s) => s.length > 0))];
  const shown = clean.slice(0, maxLabels);
  const more = clean.length - shown.length;
  return shown.join(", ") + (more > 0 ? ` and ${more} more` : "");
}

/**
 * "Some we can see: ..." in a refusal: page labels a merchant could name. A label that holds anything address-like, code-like or markup
 * (angle brackets, quotes, braces, "=", "()" after a word, "://", "www.") or that safeLabel would have to change is left out, not
 * shown in a cleaned-up form; each label is capped at `width` characters and the list at `maxLabels`.
 */
const NOT_A_PLAIN_LABEL = /[<>"`\u201c\u201d{};=\[\]\\|@^~]|\w\(|:\/\/|\bwww\.|\bjavascript\b|\bonerror\b|\bscript\b/i;
export function listPageLabels(raws: string[], maxLabels: number = 4, width: number = MAX_SHOWN_LABEL): string {
  const plain = raws.filter((raw) => {
    const collapsed = raw.replace(/\s+/g, " ").trim();
    if (collapsed.length < 2 || collapsed.length > 200 || NOT_A_PLAIN_LABEL.test(collapsed)) return false;
    return safeLabel(collapsed, 400) === collapsed && /\p{L}/u.test(collapsed);
  });
  return listLabels(plain, maxLabels, width);
}

/** The final guard: plain text, no markup characters, at most MAX_QUESTION_CHARS. */
export function boundQuestion(s: string): string {
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u206f\ufeff<>]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > MAX_QUESTION_CHARS ? `${t.slice(0, MAX_QUESTION_CHARS - 3).trimEnd()}...` : t;
}
