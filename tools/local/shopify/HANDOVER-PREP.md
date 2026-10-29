# Shopify dev-store lane — handover prep

David approved CLI login (Oct 27). Live status: **`docs/status/STREAM-SHOPIFY.md`**.

## Store (reuse as-is)

- Dev store: `heatmap-oauth-dev.myshopify.com`
- Never `--allow-live`, `theme push`, or publish to live theme
- Never delete order **#1001** or edit other projects' products/orders
- Storefront password: env name only `SHOPIFY_FLAG_STORE_PASSWORD` (never commit values)

## After David approves login

1. Install CLI: `npm install -g @shopify/cli@latest` (Node 22.12+)
2. Clone Dawn into `tools/local/shopify/theme/` (gitignored; see `docs/self-serve/F-shopify-dev-store.md` §1.9)
3. Add stand-in snippet + script tag per F §2.3 (local scripts host `8788`, sink `8790`)
4. Run: `shopify theme dev --store heatmap-oauth-dev --host 127.0.0.1 --port 9292`
5. Use **dawn-smoke** FakeAgent fixture (Seat Cover selectors do not match Dawn)

## MCQ for David (blocks interactive login)

**A)** Approve Shopify CLI login now — agent runs theme dev prep  
**B)** Defer Shopify; Kenn handover uses local fake store + `smoke:stack` only  
**C)** Approve login but David runs theme dev himself; agent only maintains docs/fixtures
