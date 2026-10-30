# Merchant UI (Track 2 local)

Plain-language screen for **what to track** → submit → wait → **hosted script URL** + test actions. Pairs with `npm run serve` (API) and `npm run local:auth` (sign-in stand-in). Heatmap.com voice; no technical jargon on the main path.

Full Track 2 steps: **`docs/status/STREAM-UI.md`**.

## Quick start (David — test end to end)

From the repo root (`agentic-klaviyo-adapter/`):

```bash
npm install
cd ui && npm install && cd ..

export HEATMAP_TOKEN_SECRET='your-local-secret-at-least-32-characters-long'
export HEATMAP_DATA_DIR=.out
export HEATMAP_SCRIPT_URL_BASE=http://127.0.0.1:8788
export UI_ORIGIN=http://127.0.0.1:5173
```

Four terminals:

| Terminal | Command | URL |
|---|---|---|
| 1 | `npm run scripts:host` | http://127.0.0.1:8788 (published scripts) |
| 2 | `npm run serve` | http://127.0.0.1:8787 (API) |
| 3 | `npm run local:auth` then open the printed link | hands off JWT to UI |
| 4 | `cd ui && npm run dev` | http://127.0.0.1:5173 |

Copy `ui/.env.local.example` → `ui/.env.local` before `npm run dev` (sets API + local sign-in link).

Fill the form (prompt, page address, 6-character Klaviyo public key). With **`npm run local:stack`**, `https://example.com/` works without pasted HTML (repo fixture under `fixtures/pages/`). For your own URLs, paste a saved HTML copy under “Details for your developer”. Optional (local testing): in that same section, turn on **Send a saved understanding result** and paste output from the Model Lab (`npm run lab`) to exercise the HTTP `interpretation` path.

One-shot check (no browser): `npm run smoke:local` → `SMOKE OK`.

**In-browser helper (BM-3 lab, optional):** `npm run models:fetch` then `npm run lab` → http://127.0.0.1:8791/ (redirects to `/lab/index.html`). Mock mode works offline; WebLLM needs Chrome/Edge + WebGPU and ~900 MB first download (`npm run models:fetch` once, about 1 GB).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Merchant UI (port 5173) |
| `npm run lab` | Model Lab only (port 8791) |
| `npm test` | Vitest (copy-lint, API client, model contract) |
| `npm run build` | Production bundle to `dist/` |

## Environment

| Name | Default | Purpose |
|---|---|---|
| `VITE_API_BASE` | `http://127.0.0.1:8787` | API origin |
| `VITE_SUPPORT_EMAIL` | (empty) | “Ask our team” line; hidden if unset |

Use `ui/.env.local` (never commit).

## Sign-in

No form here. Local auth (`npm run local:auth`) or Heatmap opens `?token=…` once; token stays in `sessionStorage`. Site id comes from the token only.

## Copy

All merchant strings: `src/copy/`. `test/copy-lint.test.ts` enforces plain language.

## Model (BM-2 / BM-3)

`src/model/` — `ModelProvider`, mock/none/WebLLM, `interpret-service`. Merchant submit still runs the server pipeline (FakeAgent by default); the lab is for trying the helper in isolation. Design: `docs/self-serve/E-browser-model.md`.


## The helper reads the words; the merchant approves (Update 46)

- `VITE_MERCHANT_MODEL` defaults to `auto` (the in-browser helper when the browser can run it). `mock` (canned answers) and `none` (no helper) exist only when set by name. With `none`, or before the helper is downloaded, submit stops and says the helper is needed; **nothing is sent and nothing is built from the words alone.** The ~1 GB download is offered by the helper card or the notice and is never started silently.
- `VITE_SERVER_READS=1` lets a request go without the helper's reading when the manifest binds a server reader (default path: OpenRouter in `manifests/http-local-openrouter.yaml` / `http-render.yaml`; optional: Claude in `http-local-claude.yaml`).
- After the reading, the server answers `needs-confirmation` with `understanding` and `interpretation`; `ConfirmScreen` shows what will be tracked (with the real page control and the test name), what will not and why, and pick-one questions, with "Yes, this is right" and "No, let me change my words". Approving posts `{ interpretation }` (answers applied by `src/confirm/apply-answers.ts`) to `POST /v1/requests/:id/approve`.
