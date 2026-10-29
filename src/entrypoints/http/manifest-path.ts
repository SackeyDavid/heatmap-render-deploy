import { join, resolve } from "node:path";

/** The HTTP service's default manifest when HEATMAP_MANIFEST is unset (a path, not a choice between adapters). */
export const DEFAULT_HTTP_MANIFEST = join("manifests", "http-local.yaml");

/**
 * Which manifest the HTTP service runs. The manifest is the only place adapters are chosen (agent, storage,
 * notifier, inspector), so the one switch is which manifest file to load; no env var picks an adapter.
 */
export function resolveManifestPath(rootDir: string, env: Record<string, string | undefined>): string {
  const explicit = env.HEATMAP_MANIFEST?.trim();
  return explicit ? resolve(explicit) : join(rootDir, DEFAULT_HTTP_MANIFEST);
}
