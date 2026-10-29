import { ContractLintGate } from "../../operations/klaviyo-segmentation/adapters/contract-lint/contract-lint.ts";
import { HeatmapGatewayKlaviyoChecks } from "../../operations/klaviyo-segmentation/adapters/heatmap-gateway/heatmap-gateway-klaviyo-checks.ts";
import { InMemoryKlaviyoChecks, TestProfileVerifier } from "../../operations/klaviyo-segmentation/adapters/test-profile-verifier/test-profile-verifier.ts";
import { RuleTableConfirmer } from "../../operations/klaviyo-segmentation/adapters/rule-table-builder/confirmer.ts";
import { DeterministicRunner } from "../../adapters/agents/deterministic/deterministic-runner.ts";
import { BUILDER_INPUTS, ruleTableBuild } from "../../operations/klaviyo-segmentation/adapters/rule-table-builder/build.ts";
import { klaviyoRequestMapper } from "../../operations/klaviyo-segmentation/http-mapper.ts";
import { KlaviyoSegmentationOperation, OPERATION_NAME } from "../../operations/klaviyo-segmentation/operation.ts";
import { loadHeatmapGatewayConfig } from "../../operations/klaviyo-segmentation/adapters/plug-in-env.ts";
import type { AgenticOperation } from "../../ports/index.ts";
import type { CreatePlugin, OperationPlugin } from "../plugin.ts";

/**
 * Klaviyo plugin. Delete this file plus src/operations/klaviyo-segmentation/ to remove the operation.
 *
 * Two pairs, chosen in the manifest, never by an env var:
 * - KlaviyoSegmentationOperation + verifier klaviyo.test-profile: the in-memory stand-in (proves plumbing, not delivery to
 *   Klaviyo). Local only: production mode refuses it.
 * - KlaviyoSegmentationOperationLive + verifier klaviyo.gateway-profile: Heatmap's gateway. Registered only when
 *   HEATMAP_KLAVIYO_GATEWAY_URL is set (a manifest that names them without it fails at startup with that hint).
 */
export const createPlugin: CreatePlugin = (env) => {
  const vars = env.vars ?? process.env;
  const fake = new InMemoryKlaviyoChecks();
  const confirmer = new RuleTableConfirmer();
  const gateway = vars.HEATMAP_KLAVIYO_GATEWAY_URL?.trim() ? new HeatmapGatewayKlaviyoChecks(loadHeatmapGatewayConfig(vars)) : undefined;
  const plugin: OperationPlugin = {
    operations: {
      KlaviyoSegmentationOperation: (prompts) => new KlaviyoSegmentationOperation(prompts, fake, confirmer) as AgenticOperation<unknown>,
      ...(gateway ? { KlaviyoSegmentationOperationLive: (prompts) => new KlaviyoSegmentationOperation(prompts, gateway, confirmer) as AgenticOperation<unknown> } : {}),
    },
    // No model, no network: reads the request and the saved page, writes the three files. Real, so it is allowed in production.
    agents: { "klaviyo.rule-table-builder": () => new DeterministicRunner({ inputs: BUILDER_INPUTS, build: ruleTableBuild, onDetail: (d) => console.error("[rule-table-builder]", d) }) },
    gates: { "klaviyo.contract-lint": new ContractLintGate() },
    verifiers: {
      "klaviyo.test-profile": new TestProfileVerifier(fake),
      ...(gateway ? { "klaviyo.gateway-profile": new TestProfileVerifier(gateway) } : {}),
    },
    localOnly: { operations: ["KlaviyoSegmentationOperation"], verifiers: ["klaviyo.test-profile"] },
    ...(gateway ? {} : { hints: { KlaviyoSegmentationOperationLive: "set HEATMAP_KLAVIYO_GATEWAY_URL", "klaviyo.gateway-profile": "set HEATMAP_KLAVIYO_GATEWAY_URL" } }),
    http: { requestMappers: { [OPERATION_NAME]: klaviyoRequestMapper } },
  };
  return plugin;
};
