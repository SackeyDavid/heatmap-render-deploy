// `npm run serve`: starts the HTTP entrypoint. Refuses to start on bad configuration (env var NAMES only in messages).
import { resolveMode } from "../../composition/startup.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../composition/wire.ts";
import { ConfigError } from "../../domain/errors.ts";
import { loadManifest } from "../../composition/manifest.ts";
import { assertNoRemovedKnobs } from "../../composition/plug-in-env.ts";
import { resolveManifestPath } from "./manifest-path.ts";
import { loadHttpConfig } from "./config.ts";
import { startHttpServer } from "./server.ts";


async function main(): Promise<number> {
  try {
    const config = loadHttpConfig(process.env);
    const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const dataDir = resolve(process.env.HEATMAP_DATA_DIR || resolve(rootDir, ".out"));
    assertNoRemovedKnobs(process.env);
    const manifestPath = resolveManifestPath(rootDir, process.env);
    resolveMode(process.env.HEATMAP_MODE, await loadManifest(manifestPath), { required: true });
    const app = await buildApp({
      rootDir,
      dataDir,
      manifestPath,
      mode: config.mode,
    });
    const logger = app.logger;
    const running = await startHttpServer({ app, config, dataDir, logger });
    logger.info("listening", { url: running.url, mode: config.mode, manifest: manifestPath });
    if (!config.scriptUrlBase) {
      logger.warn(
        "HEATMAP_SCRIPT_URL_BASE is unset; succeeded jobs may return script URLs that are not loadable in a browser. Run npm run scripts:host and set HEATMAP_SCRIPT_URL_BASE to that origin, or use npm run local:stack.",
      );
    }
    const stop = () => void running.close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return -1;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}

const code = await main();
if (code >= 0) process.exit(code);
