/**
 * File name for a saved copy of a page: `<host>__<path-slug>.html` (www. dropped; query and fragment ignored). One owner:
 * every inspector that reads saved pages and the HTTP layer that writes them use this function.
 */
export function pageFileName(url: string): string {
  const u = new URL(url);
  const pathSlug = u.pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-") || "home";
  return `${u.hostname.replace(/^www\./, "")}__${pathSlug}.html`;
}
