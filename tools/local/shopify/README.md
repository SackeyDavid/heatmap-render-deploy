# Shopify dev-store lane (F)

Store: **`heatmap-oauth-dev.myshopify.com`** (shared dev store — never `--allow-live`, `push`, or `publish`; never modify order #1001).

## Prerequisites

1. `npm install -g @shopify/cli@latest` (Node 22.12+, Git 2.28+).
2. Clone Dawn into `tools/local/shopify/theme/` (gitignored):

   ```bash
   git clone https://github.com/Shopify/dawn.git tools/local/shopify/theme
   ```

3. Apply theme patches from `theme-patches/` (stand-in snippet + Mode H script tag) — see `F-shopify-dev-store.md` §2.3.

## David-only: CLI browser login

First `theme dev` opens a browser OAuth flow. **Only David completes that step.**

```bash
export SHOPIFY_FLAG_STORE_PASSWORD='…'   # storefront password; never commit
npm run shopify:theme-dev
```

Preview: **http://127.0.0.1:9292**. Run **`npm run local:stack`** in another terminal so scripts host (`8788`) and sink are up.

## Local site id

Register site **`heatmap-oauth-dev`** via `npm run local:stack` auth link. Use page URL `http://127.0.0.1:9292/` in the merchant UI. FakeAgent serves **`fixtures/fake-agent/dawn-smoke`** when `platform` is `shopify`.

Full walkthrough: `docs/self-serve/F-shopify-dev-store.md` §6.
