/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { validateInterpretation } from "../src/operations/klaviyo-segmentation/interpretation/validate.ts";

/** Model Lab only — http://127.0.0.1:8791 (BM-3). */
export default defineConfig({
  plugins: [
    react(),
    {
      // The Lab sends the request and the model's answer here; the REAL server-side validator answers (same code as POST /v1/requests). The server never reads the request itself: it only checks the model's answer.
      name: "lab-plan-preview",
      configureServer(server) {
        server.middlewares.use("/lab/plan", (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          req.on("data", (c: Buffer) => {
            size += c.length;
            if (size <= 1_000_000) chunks.push(c);
          });
          req.on("end", () => {
            res.setHeader("content-type", "application/json");
            try {
              if (size > 1_000_000) throw new Error("too large");
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { prompt?: unknown; pageUrls?: unknown; interpretation?: unknown };
              if (typeof body.prompt !== "string" || !Array.isArray(body.pageUrls) || !body.pageUrls.every((u) => typeof u === "string")) throw new Error("bad body");
              const checked = validateInterpretation(body.interpretation, body.prompt, body.pageUrls as string[]);
              res.end(JSON.stringify(checked.ok ? { ok: true, kept: checked.interpretation.behaviours.length, dropped: checked.dropped, interpretation: checked.interpretation } : { ok: false, reason: checked.reason }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : "bad request" }));
            }
          });
        });
      },
    },
    {
      name: "lab-root-redirect",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split("?")[0] ?? "";
          if (path === "/" || path === "/index.html") {
            // A real redirect (not a rewrite) so the page's relative script path resolves under /lab/.
            res.statusCode = 302;
            res.setHeader("Location", "/lab/index.html");
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  root: ".",
  publicDir: "public",
  server: { host: "127.0.0.1", port: 8791, strictPort: true },
  build: {
    outDir: "dist-lab",
    rollupOptions: { input: "lab/index.html" },
  },
});
