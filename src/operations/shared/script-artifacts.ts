/** What every script-producing operation agrees on: the version placeholder, the files an agent must write, and the site slug rule. One owner. */
export const VERSION_PLACEHOLDER = "{{SCRIPT_VERSION}}";
export const PRIMARY_ARTIFACT = "script.js";
export const EXPECTED_OUTPUTS: string[] = ["script.js", "segments.json", "notes.md"];

/** A short lowercase name for a site, from its address or id ("www.my-shop.com" -> "myshop"). */
export function deriveSlug(urlOrId: string): string {
  let host = urlOrId;
  try {
    host = new URL(urlOrId).hostname;
  } catch {
    // not a URL; use as-is
  }
  const parts = host.replace(/^www\./, "").split(".");
  const base = parts.length > 1 ? parts.slice(0, -1).join("") : (parts[0] ?? "site");
  return base.toLowerCase().replace(/[^a-z0-9]/g, "") || "site";
}
