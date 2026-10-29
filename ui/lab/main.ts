import { interpretRequest } from "../src/model/interpret-service";
import { DEV_MOCK_GOLDENS } from "../src/model/dev-mock-goldens";
import { createModelProvider, type ModelSelect } from "../src/model/select";

const params = new URLSearchParams(location.search);
const mode = (params.get("model") ?? "mock") as ModelSelect;

const requestEl = document.querySelector("#request") as HTMLTextAreaElement;
const pageEl = document.querySelector("#page") as HTMLInputElement;
const modeEl = document.querySelector("#mode") as HTMLSelectElement;
const outEl = document.querySelector("#out") as HTMLPreElement;
const progressEl = document.querySelector("#progress") as HTMLDivElement;
const runBtn = document.querySelector("#run") as HTMLButtonElement;

modeEl.value = mode;

runBtn.addEventListener("click", () => void run());

async function run(): Promise<void> {
  outEl.textContent = "";
  progressEl.textContent = "Working…";
  runBtn.disabled = true;
  const provider = createModelProvider(modeEl.value as ModelSelect, DEV_MOCK_GOLDENS);
  try {
    const caps = await provider.capabilities();
    progressEl.textContent = caps.usable
      ? `Provider ${provider.providerId} (${caps.modelId ?? "n/a"})`
      : `Fallback: ${caps.reason ?? "not usable"}`;
    await provider.ensureReady((p) => {
      progressEl.textContent = `Loading ${Math.round(p.fraction * 100)}% (${p.stage})`;
    });
    const result = await interpretRequest(provider, requestEl.value, [pageEl.value]);
    if (result.ok) {
      outEl.textContent = JSON.stringify(result.interpretation, null, 2);
    } else {
      outEl.textContent = `${result.reason}${result.detail ? `: ${result.detail}` : ""}`;
    }
  } catch (e) {
    outEl.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    runBtn.disabled = false;
  }
}
