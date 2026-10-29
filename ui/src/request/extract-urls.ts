/** Page addresses a merchant wrote inside their description ("On https://example.com/pricing, when a visitor clicks ..."). */

const TLDS = 'com|org|net|io|co|app|dev|shop|store|ai|uk|ca|de|fr|au|me|us|eu|nl|se|es|it|biz|info';
// An address with http(s)://, or one that starts with www., or a bare name ending in a common address ending ("example.com/pricing").
const URL_RE = new RegExp(String.raw`(?:https?:\/\/[^\s<>"'()]+|www\.[^\s<>"'()]+|(?<![@\w.-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${TLDS})(?![a-z0-9-])(?:\/[^\s<>"'()]*)?)`, 'gi');

/** Takes off the comma, full stop or bracket that ends a sentence, not the address. */
const trimEnd = (u: string) => u.replace(/[.,;:!?)\]}]+$/g, '');

/** What two spellings of one page share: scheme, "www.", case of the host and a closing slash do not make a different page. */
export function pageKey(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

/**
 * The addresses in the text, in the order written, each once, with https:// added when it was left out. Only addresses that can be opened.
 * An address at the very end of the text is skipped: the merchant may still be typing it ("example.co" on the way to "example.com").
 */
export function extractPageUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    if ((m.index ?? 0) + m[0].length >= text.length) continue;
    const raw = trimEnd(m[0]);
    const full = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(full);
      if (!u.hostname.includes('.')) continue;
    } catch {
      continue;
    }
    const key = pageKey(full);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  return out;
}

/**
 * Puts addresses not yet in the boxes into the first empty box, then new boxes, up to the limit. `already` holds the pages handled before,
 * so a page the merchant removed by hand is not put back while they keep typing.
 */
export function addMentionedPages(
  pageUrls: string[],
  savedHtml: string[],
  mentioned: string[],
  already: Set<string>,
  limit: number,
): { pageUrls: string[]; savedHtml: string[]; added: string[] } {
  const urls = [...pageUrls];
  const html = [...savedHtml];
  const added: string[] = [];
  const have = new Set(urls.map(pageKey).filter(Boolean));
  for (const url of mentioned) {
    const key = pageKey(url);
    if (already.has(key) || have.has(key)) {
      already.add(key);
      continue;
    }
    const empty = urls.findIndex((u) => u.trim() === '');
    if (empty >= 0) urls[empty] = url;
    else if (urls.length < limit) (urls.push(url), html.push(''));
    else continue;
    already.add(key);
    have.add(key);
    added.push(url);
  }
  return { pageUrls: urls, savedHtml: html, added };
}
