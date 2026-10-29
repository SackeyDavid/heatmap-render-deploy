/** Page addresses a merchant wrote inside their description ("On https://example.com/pricing, when a visitor clicks ..."). */

// Only endings that are rarely ordinary words: "page.it" or "e.g.us" are not addresses.
const TLDS = 'com|org|net|io|co|app|dev|shop|store|ai|uk|ca|au|biz|info|de|fr|nl|jp|ru|br|se';
// An address with http(s)://, or one that starts with www., or a bare name ending in a common address ending ("example.com/pricing").
const URL_RE = new RegExp(String.raw`(?:https?:\/\/[^\s<>"'()\u2018\u2019\u201C\u201D]+|www\.[^\s<>"'()\u2018\u2019\u201C\u201D]+|(?<![@\p{L}\p{N}_.:/-])[\p{L}\p{N}][\p{L}\p{N}-]*(?:\.[\p{L}\p{N}-]+)*\.(?:${TLDS})(?![a-z0-9-]|\.[a-z0-9])(?::\d{1,5})?(?:[\/?#][^\s<>"'()\u2018\u2019\u201C\u201D]*)?)`, 'giu');

/** Takes off the comma, full stop or bracket that ends a sentence, not the address. */
const trimEnd = (u: string) => u.replace(/[.,;:!?)\]}]+$/g, '');

/** A name a visitor could open on the internet: not a bare number, an inside address, or a link that carries a user name. */
function openablePublicHost(u: URL): boolean {
  const h = u.hostname;
  if (u.username || u.password || !h.includes('.')) return false;
  if (/(^|\.)-|-(\.|$)|\.\.|[^\x21-\x7e]/.test(h)) return false; // empty or badly built name parts, or hidden characters
  if (/^[\d.]+$/.test(h) || h.startsWith('[') || /^0x/i.test(h)) return false; // numbers, IPv6 and hex addresses
  if (!/[a-z]/i.test(h.split('.').slice(0, -1).join('.'))) return false; // "1.2.com": a name needs a letter before the ending
  return !/\.(localhost|local|internal|invalid)$/i.test(h);
}

/** What two spellings of one page share: scheme, "www.", spelling of the host and a closing slash do not make a different page. A different path or query does. */
export function pageKey(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    return `${u.hostname.replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/+$/, '')}${u.search}`; // café.com and xn--caf-dma.com are one page; the host is not case sensitive (the URL parser lowercases it), the path and query are
  } catch {
    // fall through to the plain form
  }
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

/**
 * The addresses in the text, in the order written, each once, with https:// added when it was left out. Only addresses that can be opened.
 * Callers wait for a pause in typing first, so an address being typed is not picked up half written.
 * A name without "https://" or "www." must be all lowercase: "button.It" and "Mr.Smith.com" are words, not pages.
 */
export function extractPageUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = trimEnd(m[0]);
    if (!/^(https?:\/\/|www\.)/i.test(raw) && /[A-Z]/.test(raw.split('/')[0]!)) continue;
    const full = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(full);
      if (!openablePublicHost(u)) continue;
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

/** "examplesite.com/pricing" becomes "https://examplesite.com/pricing". Anything that already has a scheme, and anything that is not a name with a dot, is left as typed. */
export function withHttps(typed: string): string {
  const v = typed.trim();
  if (v === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v; // empty, or it already says how to open it (https://, http://, ...)
  const noSlashes = v.replace(/^\/\//, '');
  // A closing bracket from pasted text is not part of the address, unless the address has its own opening one (a wiki path such as Foo_(bar)).
  const bare = noSlashes.replace(noSlashes.includes('(') ? /[.,;:!?]+$/ : /[.,;:!?)\]}]+$/, ''); // a closing full stop or bracket from pasted text is not part of the address
  const host = bare.split(/[:/?#]/)[0] ?? '';
  const ending = host.split('.').pop() ?? '';
  if (!/^[\p{L}\p{N}][\p{L}\p{N}-]*(\.[\p{L}\p{N}-]+)+([:/?#]|$)/u.test(bare)) return v;
  if (!/^\p{L}[\p{L}-]{1,23}$/u.test(ending) || FILE_ENDINGS.has(ending.toLowerCase())) return v; // "3.14", "127.0.0.1" and "index.html" are not websites
  return `https://${bare}`;
}
const FILE_ENDINGS = new Set(['html', 'htm', 'php', 'js', 'css', 'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'json', 'xml', 'asp', 'aspx', 'md', 'csv', 'zip', 'py', 'ts', 'tsx', 'jsx', 'docx', 'xlsx', 'pptx', 'webp', 'mp4', 'mp3', 'sh', 'rb', 'go', 'java', 'rs', 'yml', 'yaml', 'log']);
