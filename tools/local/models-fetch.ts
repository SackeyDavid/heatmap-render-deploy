/**
 * BM-3 setup check. WebLLM downloads weights inside the browser on first use (~900 MB).
 * This script does not pull secrets or call paid APIs.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const webLlmPkg = join(root, "ui/node_modules/@mlc-ai/web-llm/package.json");
const lockPath = join(root, "ui/model-assets.lock.json");

console.log("Heatmap agentic ops — in-browser model (BM-3)");
console.log("");
console.log("1. cd ui && npm install   (installs @mlc-ai/web-llm)");
console.log("2. npm run lab            (from repo root — opens http://127.0.0.1:8791/)");
console.log("3. In the lab, choose WebLLM or Auto and run a sample.");
console.log("");
console.log("First WebLLM run downloads model weights in your browser (about 900 MB, one-time per browser).");
console.log("Use Chrome or Edge on a desktop with WebGPU. No API tokens are used.");
console.log("");

if (!existsSync(webLlmPkg)) {
  console.error("Missing ui/node_modules/@mlc-ai/web-llm — run: cd ui && npm install");
  process.exit(1);
}

if (!existsSync(lockPath)) {
  console.warn("Note: ui/model-assets.lock.json not found (optional for CDN-backed WebLLM in BM-3).");
}

console.log("OK — dependencies present. Open the lab when ready.");
process.exit(0);
