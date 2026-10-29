/** Starts the Model Lab Vite dev server on 127.0.0.1:8791 (BM-3). */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "../../ui");

const child = spawn("npm", ["run", "lab"], {
  cwd: uiDir,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, FORCE_COLOR: "1" },
});

child.on("exit", (code) => process.exit(code ?? 0));
