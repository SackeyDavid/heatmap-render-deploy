import { ConfigError } from "../../../domain/errors.ts";
import type { HeatmapGatewayConfig } from "./heatmap-gateway/heatmap-gateway-klaviyo-checks.ts";

/** Reads the Heatmap gateway settings. The gateway is chosen in the manifest (operation adapter + verifier name), never by an env var. */
export function loadHeatmapGatewayConfig(env: Record<string, string | undefined>): HeatmapGatewayConfig {
  const problems: string[] = [];
  const raw = env.HEATMAP_KLAVIYO_GATEWAY_URL?.trim();
  if (!raw) problems.push("HEATMAP_KLAVIYO_GATEWAY_URL is required when this plug-in is active");
  if (problems.length) throw new ConfigError(problems);
  try {
    const u = new URL(raw!);
    if (u.protocol !== "https:" && u.protocol !== "http:") problems.push("HEATMAP_KLAVIYO_GATEWAY_URL must be http(s)");
  } catch {
    problems.push("HEATMAP_KLAVIYO_GATEWAY_URL must be a valid URL");
  }
  if (problems.length) throw new ConfigError(problems);
  return {
    baseUrl: raw!.replace(/\/+$/, ""),
    ...(env.HEATMAP_KLAVIYO_GATEWAY_KEY?.trim() ? { apiKey: env.HEATMAP_KLAVIYO_GATEWAY_KEY.trim() } : {}),
  };
}
