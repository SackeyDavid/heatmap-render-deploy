/**
 * Dev-only demo page: serves a saved page with the Heatmap stand-in and a published script installed, in the same
 * order a merchant installs them (Heatmap first, then the generated script). Loopback only. Nothing is sent anywhere.
 *
 *   node --import tsx tools/local/demo-page.ts --port 28790 --scripts http://127.0.0.1:28788 --site example-site \
 *       [--page fixtures/pages/manduu.com__home.html] [--version <12-hex>]
 *
 * Open http://127.0.0.1:<port>/ in a browser, do the actions, then read window.__hmEvents (the events Heatmap would
 * receive, once per name per visit) or the console lines starting "Heatmap>Klaviyo". Clear hCT_ keys in localStorage to retest.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LOCAL_ROOT } from "./env.ts";

const { values } = parseArgs({
  options: { port: { type: "string", default: "28790" }, scripts: { type: "string", default: "http://127.0.0.1:8788" }, site: { type: "string", default: "example-site" }, page: { type: "string", default: "fixtures/pages/manduu.com__home.html" }, version: { type: "string" } },
});
const scripts = values.scripts!.replace(/\/+$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(scripts)) throw new Error("--scripts must be a loopback address");
const html = await readFile(resolve(LOCAL_ROOT, values.page!), "utf8");
const script = values.version ? `${scripts}/sites/${values.site}/klaviyo/${values.version}/script.js` : `${scripts}/sites/${values.site}/klaviyo/current.js`;
const tall = `<style>body{min-height:4200px}</style>`;
const install = `${tall}\n<script src="${scripts}/__hm/heatmap-fake.js"></script>\n<script src="${script}"></script>\n`;
const page = html.includes("</body>") ? html.replace("</body>", `${install}</body>`) : html + install;

const server = createServer((req, res) => {
  if (req.url === "/" || req.url?.startsWith("/?")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page);
  } else {
    res.writeHead(404).end("not found");
  }
});
server.listen(Number(values.port), "127.0.0.1", () => console.log(`demo page http://127.0.0.1:${values.port}/  (heatmap stand-in, then ${script})`));
