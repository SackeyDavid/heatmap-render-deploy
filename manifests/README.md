# Manifests

The manifest is the only place adapters are chosen. `HEATMAP_MANIFEST` picks the file for the HTTP service and the local stack; the CLI takes `--manifest`. The shipped ones repeat the same Klaviyo steps, and `test/composition/manifest-drift.test.ts` pins what may differ between them, including that every manifest running the rule-table builder has a `confirm` step before `generate`.

| File | Use |
|---|---|
| `http-local.yaml` | Default for `npm run serve` and `npm run local:stack`: FakeAgent (its Claude fallback declared `DisabledAgent`), `saved-html` inspector with the repo's sample pages as a fallback, local-fs storage, console notifier. |
| `http-local-claude.yaml` | The Claude Code agent as the server-side INTERPRETER (`npm run serve:claude`, `npm run local:stack:claude`): a `confirm` step asks it to read the description and write `interpretation.json` (prompt `prompts/klaviyo/interpret.md`), the merchant approves, and the deterministic builder renders the script; Claude never writes the script here. Costs Claude usage (one small `claude -p` per request that arrives without the browser helper's reading). Run the UI with `VITE_SERVER_READS=1` so it may send a request without the helper. |
| `http-local-builder.yaml`, `builder.yaml` | The deterministic builder behind a `confirm` step; the reading must arrive with the request (the browser helper) or, for the CLI, in the input file (`modelInterpretation` + `approval`). |
| `http-production.example.yaml` | Example production wiring: S3 storage, SMTP notifier, Claude agent, the gateway verifier pair. Needs `HEATMAP_MODE=production` (the production guard refuses local-only adapters) and the companion env vars; check with `HEATMAP_MODE=production HEATMAP_MANIFEST=manifests/http-production.example.yaml npm run plug-in:check`. |
| `operations.yaml` | CLI default: fixture page inspector (recorded snapshots under `fixtures/pages/`), both operations. |
| `seatcover.yaml` | Seat Cover deliverable run (fixture inspector). |
| `live.yaml` | Opt-in wiring where the real agent WRITES the script (the alternative design: LLM writes the JS, lint + repair loop as the gate). No confirm step; used only by the opt-in live test. |

Bindings are an adapter name, or `{ adapter, ...settings }` when the adapter takes settings (e.g. `pageInspector: { adapter: saved-html, fallbackRoots: [fixtures/pages] }`). Unknown keys, wrong value types and missing folders fail at startup.
