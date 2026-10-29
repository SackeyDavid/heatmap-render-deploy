// Start the local sign-in stand-in:  HEATMAP_TOKEN_SECRET=<32+ chars> npm run local:auth
import { configFromEnv, createAuthServer, listenLoopback, HOST } from "./server.ts";

try {
  const cfg = configFromEnv(process.env);
  const port = await listenLoopback(createAuthServer(cfg), cfg.port);
  console.log(`Local Heatmap sign-in stand-in (dev only) on http://${HOST}:${port}`);
  console.log(`Sites file: ${cfg.registryFile}. Request a link: http://${HOST}:${port}/signin?site=<siteId>`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
