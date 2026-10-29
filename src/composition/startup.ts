import { ConfigError } from "../domain/errors.ts";
import type { Manifest } from "./manifest.ts";
import { productionLikeBindings } from "./production-guard.ts";

/**
 * The one rule for "what mode is this process in", used by serve, the CLI and plug-in:check so they cannot drift.
 * `raw` is HEATMAP_MODE (or the CLI's --mode). An invalid value always fails. An unset value fails when `required`
 * (the HTTP service), or when the manifest binds production adapters (s3, smtp): the mode must be said out loud.
 */
export function resolveMode(raw: string | undefined, manifest: Manifest, opts: { required: boolean }): "local" | "production" | undefined {
  if (raw !== undefined && raw !== "local" && raw !== "production") throw new ConfigError(['HEATMAP_MODE must be "local" or "production"']);
  if (raw !== undefined) return raw;
  const unsaid = productionLikeBindings(manifest);
  if (opts.required || unsaid.length > 0) {
    throw new ConfigError([
      `HEATMAP_MODE is not set${unsaid.length > 0 ? ` but the manifest binds production adapters (${unsaid.join(", ")})` : ""}: set HEATMAP_MODE=production or HEATMAP_MODE=local (the CLI also takes --mode) so the guard knows what this deployment is`,
    ]);
  }
  return undefined;
}
