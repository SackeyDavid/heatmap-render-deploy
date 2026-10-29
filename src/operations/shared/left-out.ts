/**
 * The parts of a request the script does NOT cover, read from the "Not tracked" section of a published notes.md, for the
 * merchant's success page and email. Plain sentences only: markup, addresses and control characters are removed, each item is
 * cut short, and at most MAX_LEFT_OUT items are returned. Bad or missing text gives an empty list, never an error.
 */
export const MAX_LEFT_OUT = 8;
export const MAX_LEFT_OUT_CHARS = 160;

/** Control characters, bidi and zero-width marks, line and paragraph separators, BOM. */
const INVISIBLE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2028\\u2029\\u2060-\\u2064\\u2066-\\u2069\\ufeff]", "g");

function plainSentence(raw: string): string {
  let t = raw
    .replace(INVISIBLE, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, " ")
    .replace(/\bwww\.\S*/gi, " ")
    .replace(/[<>`*_\\|{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > MAX_LEFT_OUT_CHARS) t = `${t.slice(0, MAX_LEFT_OUT_CHARS - 1).replace(/\s+\S*$/, "").replace(/[\s,;:(-]+$/, "")}...`;
  if (t === "") return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(t) || t.endsWith("...") ? t : `${t}.`;
}

export function leftOutFromNotes(notesText: string): string[] {
  try {
    const lines = String(notesText).split(/\r?\n/);
    const start = lines.findIndex((l) => /^##\s+not\s+tracked\b/i.test(l.trim()));
    if (start < 0) return [];
    const items: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (/^#{1,6}\s/.test(line.trim())) break;
      const m = /^\s*[-*]\s+(.*)$/.exec(line);
      if (!m) continue;
      const s = plainSentence(m[1]!);
      if (s !== "" && !items.includes(s)) items.push(s);
      if (items.length >= MAX_LEFT_OUT) break;
    }
    return items;
  } catch {
    return [];
  }
}
