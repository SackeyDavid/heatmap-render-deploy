import { useState } from "react";
import { validateInterpretation } from "../src/browser-model";
import { modelCopy } from "../src/copy/model";
import { interpretRequest } from "../src/model/interpret-service";
import { DEV_MOCK_GOLDENS } from "../src/model/dev-mock-goldens";
import { createModelProvider, type ModelSelect } from "../src/model/select";
import { HeatmapBrand } from "../src/components/HeatmapBrand";

const SAMPLES: { label: string; text: string; pages: string[] }[] = [
  {
    label: "FAQ open (golden g01)",
    text: "Tell me when someone opens a FAQ.",
    pages: ["https://example.com/"],
  },
  {
    label: "Vehicle picker (paraphrase)",
    text: "Let me know each time someone gets going with the vehicle picker",
    pages: ["https://www.seatcoversolutions.com/"],
  },
  {
    label: "Scroll halfway (g16)",
    text: "Fire when a visitor scrolls halfway down the page.",
    pages: ["https://example.com/pricing"],
  },
];

export function LabApp() {
  const [text, setText] = useState(SAMPLES[0]!.text);
  const [pages, setPages] = useState(SAMPLES[0]!.pages[0]!);
  const [mode, setMode] = useState<ModelSelect>("mock");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<string>("");
  const [validation, setValidation] = useState<string>("");
  const [error, setError] = useState("");
  const [ms, setMs] = useState<number | null>(null);
  const [plan, setPlan] = useState("");
  const [lastInterpretation, setLastInterpretation] = useState<unknown>(null);

  const run = async () => {
    setBusy(true);
    setError("");
    setRaw("");
    setParsed("");
    setValidation("");
    setMs(null);
    setProgress("");
    setPlan("");
    setLastInterpretation(null);
    const provider = createModelProvider(mode, DEV_MOCK_GOLDENS);
    const pageList = pages.split(",").map((p) => p.trim()).filter(Boolean);
    try {
      const caps = await provider.capabilities();
      if (!caps.usable && mode !== "mock") {
        setError(
          caps.reason === "no-webgpu"
            ? modelCopy.notSupported
            : modelCopy.failed,
        );
        return;
      }
      const out = await interpretRequest(
        provider,
        text,
        pageList,
        undefined,
        (p) => setProgress(`${modelCopy.downloading} ${Math.round(p.fraction * 100)}%`),
      );
      if (!out.ok) {
        setError(`${out.reason}${out.detail ? `: ${out.detail}` : ""}`);
        return;
      }
      setRaw(out.rawText);
      setMs(out.ms);
      setParsed(JSON.stringify(out.interpretation, null, 2));
      setLastInterpretation(out.interpretation);
      const checked = validateInterpretation(out.interpretation, text, pageList);
      if (!checked.ok) {
        setValidation(`Rejected: ${checked.reason}${checked.detail ? ` (${checked.detail})` : ""}`);
      } else {
        const lines = [
          `${checked.behaviours.length} behaviour(s) accepted`,
          ...checked.dropped.map((d) => `Dropped #${d.index}: ${d.reason}`),
        ];
        setValidation(lines.join("\n"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
      await provider.unload();
    }
  };

  /** BM-4: the server-side rule parse + validator + merge, with and without the model's proposal. */
  const understand = async () => {
    setPlan("Working…");
    const pageUrls = pages.split(",").map((p) => p.trim()).filter(Boolean);
    const ask = async (interpretation: unknown) => {
      const r = await fetch("/lab/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, pageUrls, ...(interpretation ? { interpretation } : {}) }),
      });
      return (await r.json()) as Record<string, unknown>;
    };
    try {
      const withModel = lastInterpretation ? await ask(lastInterpretation) : null;
      setPlan(withModel ? `What the server's checks keep of the helper's answer:\n${JSON.stringify(withModel, null, 2)}` : "Run the helper first, then see what the server's checks keep of its answer.");
    } catch (e) {
      setPlan(`Could not reach the lab server: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <header className="hm-site-header">
        <div className="hm-site-header__inner">
          <HeatmapBrand />
        </div>
      </header>
      <div className="hm-page">
    <main id="main">
      <p className="hint">Local Model Lab (developer tool). Nothing here is sent to a paid API.</p>

      <h1>Try the in-browser helper</h1>
      <p className="hint">
        Mock mode uses saved answers. WebGPU mode downloads about 900 MB on first run, then runs on your computer.
      </p>

      <div className="field">
        <label htmlFor="mode">Mode</label>
        <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as ModelSelect)}>
          <option value="mock">Mock (offline, canned)</option>
          <option value="auto">Auto (WebGPU if available, else skip)</option>
          <option value="webllm">WebLLM (real download)</option>
          <option value="none">None (should fail)</option>
        </select>
      </div>

      <div className="field">
        <span className="hint">Samples</span>
        <div className="inline">
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              className="secondary"
              onClick={() => {
                setText(s.text);
                setPages(s.pages.join(", "));
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="req">What the merchant might type</label>
        <textarea id="req" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="pages">Page addresses (comma-separated)</label>
        <input id="pages" value={pages} onChange={(e) => setPages(e.target.value)} />
      </div>

      <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
        {busy ? "Working…" : "Run helper"}
      </button>
      <button type="button" className="secondary" onClick={() => void understand()}>
        Understand and plan
      </button>
      {progress && <p role="status">{progress}</p>}

      {error && (
        <div role="alert" className="error-summary">
          <p>{error}</p>
        </div>
      )}

      {ms !== null && <p>Generation took {ms} ms.</p>}

      {raw && (
        <details open>
          <summary>Raw model output</summary>
          <pre className="lab-pre">{raw}</pre>
        </details>
      )}

      {parsed && (
        <details open>
          <summary>Parsed interpretation (browser schema check)</summary>
          <pre className="lab-pre">{parsed}</pre>
        </details>
      )}

      {validation && (
        <details open>
          <summary>Safety check (evidence and allowed fields)</summary>
          <pre className="lab-pre">{validation}</pre>
          <p className="hint">
            The page match and the merchant approval happen on the server when you submit the merchant form.
          </p>
        </details>
      )}

      {plan && (
        <details open>
          <summary>Server-side checks of the helper's answer</summary>
          <pre className="lab-pre">{plan}</pre>
        </details>
      )}
    </main>
      </div>
    </>
  );
}
