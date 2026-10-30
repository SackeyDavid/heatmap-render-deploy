import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { MAX_SAVED_PAGE_BYTES } from "../../../domain/page-limits.ts";
import type { PageSnapshot } from "../../../domain/types.ts";
import type { PageInspector } from "../../../ports/index.ts";
import { DEFAULT_MAX_CONTROLS, extractFromHtml, sanitizeText } from "../saved-html/html-controls.ts";
import { NoSavedCopy } from "../saved-html/saved-html-inspector.ts";

/** Addresses a public website never lives at: this machine, private networks, link-local (cloud metadata), carrier-grade NAT, multicast. */
const PRIVATE = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** True for an address a public website can have. An IPv4 address inside an IPv6 one (::ffff:10.0.0.1) is judged as the IPv4 address. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1]! : address;
  const kind = isIP(ip);
  return kind !== 0 && !PRIVATE.check(ip, kind === 4 ? "ipv4" : "ipv6");
}

/** Resolves a name and refuses it when ANY answer is not public. This is the lookup the connection itself uses, so the answer checked is the answer connected to. */
const safeLookup = ((hostname: string, options: unknown, cb: (...args: unknown[]) => void) =>
  dnsLookup(hostname, options as never, ((err: Error | null, address: unknown, family: unknown) => {
    if (err) return cb(err, address, family);
    const list = Array.isArray(address) ? (address as { address: string }[]).map((a) => a.address) : [String(address)];
    if (list.length === 0 || !list.every(isPublicAddress)) return cb(new Error("not a public address"), "", 4);
    cb(null, address, family);
  }) as never)) as never;

export interface FetchedPage {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
/** One GET of an https address (no redirects followed here). Injectable so tests never touch the network. */
export type PageGet = (url: URL, limits: { maxBytes: number; timeoutMs: number }) => Promise<FetchedPage>;

/** The real GET: https only, plain port, public addresses only, bounded in time and size, compressed answers unpacked within the same size limit. */
export const httpsPageGet: PageGet = (url, { maxBytes, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "GET", lookup: safeLookup, headers: { "User-Agent": "Mozilla/5.0 (compatible; HeatmapSetupReader/1.0)", Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "gzip, deflate, br" } },
      (res) => {
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream = encoding === "gzip" ? res.pipe(createGunzip()) : encoding === "deflate" ? res.pipe(createInflate()) : encoding === "br" ? res.pipe(createBrotliDecompress()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new Error("too large"));
            return;
          }
          chunks.push(c);
        });
        stream.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        stream.on("error", () => reject(new Error("unreadable")));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timed out")));
    req.on("error", (e) => reject(e));
    req.end();
  });

export interface LiveFetchOptions {
  /** Tried first: the request's own saved pages. The live page is fetched only when this has no saved copy of the address. */
  inner: PageInspector;
  get?: PageGet;
  maxHtmlBytes?: number;
  maxControls?: number;
  timeoutMs?: number;
}

const MAX_REDIRECTS = 3;

/**
 * Reads the real page from the web when the request carries no saved copy. https only, standard port, no credentials in the address, public
 * addresses only (checked at connection time, on every redirect too), time and size limits, HTML only. The page text is untrusted exactly
 * like a saved page's: the same control extraction and sanitising apply. Every failure is a plain-language Error.
 */
export class LiveFetchInspector implements PageInspector {
  private readonly get: PageGet;
  constructor(private readonly opts: LiveFetchOptions) {
    this.get = opts.get ?? httpsPageGet;
  }

  async snapshot(url: string): Promise<PageSnapshot> {
    try {
      return await this.opts.inner.snapshot(url);
    } catch (e) {
      if (!(e instanceof NoSavedCopy)) throw e;
    }
    const shown = sanitizeText(String(url), 200);
    const cannot = (why: string) => new Error(`We could not open ${shown} (${why}). Check the address, or save the page and add it to the request.`);
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      throw cannot("it is not a web address");
    }
    const maxBytes = this.opts.maxHtmlBytes ?? MAX_SAVED_PAGE_BYTES;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "https:") throw cannot("only https addresses can be opened");
      if (current.username || current.password) throw cannot("the address must not hold a sign-in");
      if (current.port !== "") throw cannot("the address must use the standard port");
      if (isIP(current.hostname.replace(/^\[|\]$/g, "")) !== 0) throw cannot("the address must be a website name");
      let page: FetchedPage;
      try {
        page = await this.get(current, { maxBytes, timeoutMs: this.opts.timeoutMs ?? 15_000 });
      } catch (e) {
        throw cannot(e instanceof Error && e.message === "too large" ? "the page is too large" : "the site did not answer");
      }
      if (page.status >= 300 && page.status < 400) {
        const location = page.headers.location;
        if (typeof location !== "string" || location === "") throw cannot("it sent us somewhere we cannot follow");
        try {
          current = new URL(location, current);
        } catch {
          throw cannot("it sent us somewhere we cannot follow");
        }
        continue;
      }
      if (page.status < 200 || page.status >= 300) throw cannot(`the site answered ${page.status}`);
      if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(String(page.headers["content-type"] ?? ""))) throw cannot("it is not a web page");
      const html = page.body.toString("utf8");
      let extracted;
      try {
        extracted = extractFromHtml(html, { maxControls: this.opts.maxControls ?? DEFAULT_MAX_CONTROLS });
      } catch {
        throw cannot("we could not read it");
      }
      const snap: PageSnapshot = { url, title: extracted.title, html, controls: extracted.controls, totalControls: extracted.totalControls };
      if (extracted.truncated) snap.controlsTruncated = true;
      if (extracted.hiddenControls.length > 0) snap.hiddenControls = extracted.hiddenControls;
      return snap;
    }
    throw cannot("it sent us around too many times");
  }
}
