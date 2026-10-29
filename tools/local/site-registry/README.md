# Local sign-in stand-in (dev only)

A tiny local server that plays the part of Heatmap's login and site list, so the UI and HTTP service can be tested without Heatmap access. It issues the same kind of signed token the real Heatmap backend would. It is removable and is not part of the shipped product.

## Run it

**Easiest:** one terminal for API + scripts host + auth — `HEATMAP_TOKEN_SECRET=<your-32+-char-secret> npm run local:stack` (see `docs/status/STREAM-RUNTIME.md`).

Or auth alone:

1. Pick a secret of at least 32 characters (any random string) and start it:
   `HEATMAP_TOKEN_SECRET=<your-32+-char-secret> npm run local:auth`
   The HTTP service must be started with the SAME value in `HEATMAP_TOKEN_SECRET`.
2. Open `http://127.0.0.1:8786/signin?site=example-site`. The page shows a **Continue sign-in** button with your one-time link (also logged for debugging).
3. Click **Continue sign-in** (single use, valid 48 hours). You are sent to the UI (`UI_BASE`, default `http://127.0.0.1:5173`) with `?token=...`.

The first run creates `.local-data/sites.json` (git-ignored) with one example site.

## Add a site

`curl -X POST http://127.0.0.1:8786/api/sites -H 'content-type: application/json' -d '{"siteId":"my-shop","userId":"u1","userEmail":"me@example.test","label":"My shop"}'`

Or edit `.local-data/sites.json` (`{ "sites": [{ "siteId", "userId", "userEmail", "label" }] }`). `siteId`: letters, digits, `_`, `-`, no dots, up to 64 characters. `GET /api/sites` lists them (no secrets).

## Settings (environment)

`HEATMAP_TOKEN_SECRET` (required, 32+ chars), `UI_BASE`, `LOCAL_AUTH_PORT` (8786), `LOCAL_TOKEN_TTL_SECONDS` (default 28800 = 8 h, max 86400), `LOCAL_SITES_FILE`.

## Tests

`npm run test:local-auth` (also run by `npm run verify`).

## What it is NOT

- Not Heatmap's login and not a security boundary: anyone who can open the sign-in page on loopback can mint a link. It binds to 127.0.0.1 only.
- Not for production: it refuses to start when `HEATMAP_MODE=production`.
- The core and the Klaviyo operation never import it. Tokens carry `iss: "heatmap-local"`.
