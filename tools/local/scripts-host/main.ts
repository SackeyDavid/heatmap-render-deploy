import { storageDir } from "../../../src/domain/data-layout.ts";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startScriptsHost } from "./server.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dataDir = resolve(process.env.HEATMAP_DATA_DIR || join(rootDir, ".out"));
const host = process.env.HEATMAP_SCRIPTS_HOST || "127.0.0.1";
const port = Number(process.env.HEATMAP_SCRIPTS_PORT || "8788");
const origins = (process.env.HEATMAP_SCRIPTS_CORS_ORIGINS || "http://127.0.0.1:5173,http://127.0.0.1:9292,http://localhost:9292")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const running = await startScriptsHost({ host, port, storageRoot: storageDir(dataDir), corsOrigins: origins });
console.error(JSON.stringify({ level: "info", message: "scripts host listening", url: running.url }));
const stop = () => void running.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
