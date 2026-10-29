import { DEV_MOCK_GOLDENS } from './dev-mock-goldens';

/** Normalize merchant prompt text for prefix matching (same rules as mock goldens). */
export function normalizePromptKey(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Plain-language starters for predictive chips (mock goldens + common requests). */
export const MERCHANT_PROMPT_PHRASES: readonly string[] = [
  'Tell me when someone opens a FAQ.',
  'Fire when a visitor scrolls halfway down the page.',
  'Let me know each time someone gets going with the vehicle picker.',
  'Tell me when a visitor clicks Add to cart.',
  'Tell me when someone starts checkout.',
  'Let me know when a visitor submits the contact form.',
  'Track when someone watches the product video.',
  'Tell me when a visitor opens the size guide.',
  ...Object.keys(DEV_MOCK_GOLDENS).map((k) => {
    const c = k.charAt(0).toUpperCase() + k.slice(1);
    return c.endsWith('.') ? c : `${c}.`;
  }),
];

/** Common things shoppers do, so the built-in suggestions cover more than a handful of sentences. */
const VISITOR_ACTIONS: readonly string[] = [
  'clicks Add to cart',
  'clicks the buy button',
  'clicks a link in the menu',
  'hovers over a product image',
  'hovers over the size guide',
  'deletes an item from the cart',
  'removes a product from the cart',
  'adds a product to the cart',
  'adds something to their wishlist',
  'scrolls halfway down the page',
  'scrolls to the bottom of the page',
  'opens the FAQ',
  'opens the size guide',
  'opens the search box',
  'searches for a product',
  'submits the contact form',
  'signs up for the newsletter',
  'fills in the email box',
  'starts checkout',
  'applies a discount code',
  'watches the product video',
  'plays a video',
  'views a product page',
  'selects a size or colour',
  'closes a pop-up',
  'logs in to their account',
];
const LEAD_INS: readonly string[] = ['Tell me when a visitor', 'Tell me when someone', 'Let me know when a visitor', 'Fire when a visitor'];

const UNIQUE_PHRASES = [
  ...new Set([
    ...MERCHANT_PROMPT_PHRASES.map((p) => p.trim()),
    ...LEAD_INS.flatMap((lead) => VISITOR_ACTIONS.map((a) => `${lead} ${a}.`)),
  ]),
];

/** Local prefix / substring matches for predictive chips (no model call). */
export function listLocalPromptSuggestions(input: string, limit = 3): string[] {
  const norm = normalizePromptKey(input);
  if (!norm) {
    return UNIQUE_PHRASES.slice(0, limit);
  }
  const starts = UNIQUE_PHRASES.filter((p) => normalizePromptKey(p).startsWith(norm));
  if (starts.length >= limit) return starts.slice(0, limit);
  const includes = UNIQUE_PHRASES.filter(
    (p) => !starts.includes(p) && normalizePromptKey(p).includes(norm),
  );
  const early = [...starts, ...includes];
  if (early.length >= limit) return early.slice(0, limit);
  // The merchant typed their own opening: match the last few words they typed against the end of a known sentence.
  const tails = UNIQUE_PHRASES.filter((p) => !early.includes(p) && tailCompletion(input, p) !== null);
  return [...early, ...tails].slice(0, limit);
}

/**
 * The merchant wrote their own opening ("Tell me whenever a shopper dele"): find the longest run of their last
 * words (up to 4) that starts a word in the phrase, and offer the rest of that phrase.
 */
export function tailCompletion(input: string, phrase: string): string | null {
  const trimmedEnd = input.replace(/\s+$/, '');
  const trailing = input.slice(trimmedEnd.length);
  const words = trimmedEnd.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const lowerPhrase = phrase.toLowerCase();
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const frag = words.slice(-n).join(' ').toLowerCase() + trailing;
    if (frag.trim().length < 3) continue;
    let from = 0;
    for (;;) {
      const at = lowerPhrase.indexOf(frag, from);
      if (at < 0) break;
      const boundary = at === 0 || /[\s]/.test(lowerPhrase[at - 1]!);
      const rest = phrase.slice(at + frag.length);
      if (boundary && rest.length > 0) return rest;
      from = at + 1;
    }
  }
  return null;
}

/** Suffix to append when the phrase extends what the merchant already typed. */
export function completionSuffix(input: string, phrase: string): string | null {
  if (!input.trim()) return null;
  if (phrase.toLowerCase().startsWith(input.toLowerCase())) {
    const tail = phrase.slice(input.length);
    return tail.length > 0 ? tail : null;
  }
  return tailCompletion(input, phrase);
}

/** Tab / accept: extend partial text or replace with the full phrase. */
export function applyPromptSuggestion(input: string, phrase: string): string {
  const suffix = completionSuffix(input, phrase);
  if (suffix !== null) return input + suffix;
  return phrase;
}
