/** Infer ecommerce platform from site id and page URLs (Track 2 Shopify dev-store lane). */
export function inferPlatform(siteId: string, pageUrls: string[]): "custom" | "shopify" {
  const id = siteId.toLowerCase();
  if (id.includes("myshopify")) return "shopify";
  for (const raw of pageUrls) {
    try {
      const u = new URL(raw);
      if (u.hostname.endsWith(".myshopify.com")) return "shopify";
      if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === "9292") return "shopify";
    } catch {
      /* skip invalid URLs */
    }
  }
  return "custom";
}
