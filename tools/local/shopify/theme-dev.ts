import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const themeDir = join(rootDir, "tools", "local", "shopify", "theme");
const store = process.env.SHOPIFY_STORE || "heatmap-oauth-dev";
const port = process.env.SHOPIFY_THEME_PORT || "9292";
const host = process.env.SHOPIFY_THEME_HOST || "127.0.0.1";

if (!existsSync(join(themeDir, "layout", "theme.liquid"))) {
  console.error(
    JSON.stringify({
      level: "error",
      message: "Dawn theme not found",
      hint: "git clone https://github.com/Shopify/dawn.git tools/local/shopify/theme",
      themeDir,
    }),
  );
  process.exit(1);
}

if (!process.env.SHOPIFY_FLAG_STORE_PASSWORD) {
  console.error(
    JSON.stringify({
      level: "warn",
      message: "SHOPIFY_FLAG_STORE_PASSWORD is not set; theme dev may fail on the storefront password gate",
    }),
  );
}

const args = [
  "theme",
  "dev",
  "--store",
  store,
  "--port",
  port,
  "--host",
  host,
  "--path",
  themeDir,
];
if (process.env.SHOPIFY_FLAG_STORE_PASSWORD) {
  args.push("--store-password", process.env.SHOPIFY_FLAG_STORE_PASSWORD);
}

console.error(
  JSON.stringify({
    level: "info",
    message: "Starting shopify theme dev (development theme only)",
    store,
    preview: `http://${host}:${port}`,
    note: "Complete browser login when prompted (David only). Never use --allow-live.",
  }),
);

const child = spawn("shopify", args, { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
