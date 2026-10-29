import { GenericHeatmapEventsLintGate } from "../../operations/generic-heatmap-events/adapters/contract-lint-gate.ts";
import { InMemoryPartnerEventChecks } from "../../operations/generic-heatmap-events/adapters/fake-partner-checks.ts";
import { GenericHeatmapEventsVerifier } from "../../operations/generic-heatmap-events/adapters/test-partner-verifier.ts";
import { genericRequestMapper } from "../../operations/generic-heatmap-events/http-mapper.ts";
import { GenericHeatmapEventsOperation, OPERATION_NAME } from "../../operations/generic-heatmap-events/operation.ts";
import type { CreatePlugin } from "../plugin.ts";

/** Generic Heatmap custom-event partner (operation #2). No live third-party APIs. */
export const createPlugin: CreatePlugin = () => {
  const partner = new InMemoryPartnerEventChecks();
  return {
    operations: {
      GenericHeatmapEventsOperation: (prompts) => new GenericHeatmapEventsOperation(prompts),
    },
    gates: { "generic.heatmap-events.contract-lint": new GenericHeatmapEventsLintGate() },
    verifiers: { "generic.heatmap-events.test-profile": new GenericHeatmapEventsVerifier(partner) },
    // Only an in-memory partner stand-in exists (no live third-party API), so this verifier is never production-grade.
    localOnly: { verifiers: ["generic.heatmap-events.test-profile"] },
    http: { requestMappers: { [OPERATION_NAME]: genericRequestMapper } },
  };
};
