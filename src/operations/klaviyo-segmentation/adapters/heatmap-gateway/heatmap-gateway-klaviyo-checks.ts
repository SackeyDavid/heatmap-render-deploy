import type { VerificationResult } from "../../../../domain/types.ts";
import type { KlaviyoChecks, PrerequisiteCheck } from "../../ports.ts";

export interface HeatmapGatewayConfig {
  baseUrl: string;
  apiKey?: string;
  /** How long one gateway call may take. Default 15 s, so an unresponsive gateway cannot hang a job step. */
  timeoutMs?: number;
}

interface GatewayTestEventsResponse {
  eventsSeen?: string[];
  details?: Record<string, unknown>;
  error?: string;
}

interface GatewayPrerequisitesResponse {
  klaviyoJsInstalled?: boolean;
  integrationConnected?: boolean;
  error?: string;
}

/**
 * Live Klaviyo / Heatmap integration checks via Kenn's gateway (Deferred D3).
 * Chosen in the manifest: operation adapter KlaviyoSegmentationOperationLive and verifier klaviyo.gateway-profile.
 */
export class HeatmapGatewayKlaviyoChecks implements KlaviyoChecks {
  constructor(private readonly cfg: HeatmapGatewayConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  async checkPrerequisites(args: { siteId: string; publicKey: string }): Promise<PrerequisiteCheck> {
    const url = new URL("/v1/klaviyo/prerequisites", this.cfg.baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new Error(`Heatmap Klaviyo gateway prerequisites failed (HTTP ${res.status})`);
    const body = (await res.json()) as GatewayPrerequisitesResponse;
    if (body.error) throw new Error(`Heatmap Klaviyo gateway prerequisites error: ${body.error}`);
    return {
      klaviyoJsInstalled: Boolean(body.klaviyoJsInstalled),
      integrationConnected: Boolean(body.integrationConnected),
    };
  }

  async sendTestEvents(args: {
    siteId: string;
    publicKey: string;
    jobId: string;
    events: string[];
    scriptVersion: string;
  }): Promise<Pick<VerificationResult, "details"> & { eventsSeen: string[] }> {
    const url = new URL("/v1/klaviyo/test-events", this.cfg.baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new Error(`Heatmap Klaviyo gateway test-events failed (HTTP ${res.status})`);
    const body = (await res.json()) as GatewayTestEventsResponse;
    if (body.error) throw new Error(`Heatmap Klaviyo gateway test-events error: ${body.error}`);
    const details: Record<string, string> = {};
    if (body.details && typeof body.details === "object") {
      for (const [k, v] of Object.entries(body.details)) details[k] = String(v);
    }
    return {
      eventsSeen: Array.isArray(body.eventsSeen) ? body.eventsSeen.map(String) : [],
      details,
    };
  }
}
